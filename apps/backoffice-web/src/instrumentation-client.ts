const nativeFetch = globalThis.fetch.bind(globalThis);
const PROMPTPAY_HOST = "promptpay.io";
const PROMPTPAY_PATH_PATTERN = /^\/(\d{9,15})\/(\d+(?:\.\d{1,2})?)\/?$/;

// Vercel Hobby emergency request budget guard.
// Legacy read loops are coalesced in the browser so repeated snapshots inside 30s do
// not reach Vercel. The cache is document-local, GET-only, and invalidated whenever a
// same-origin API mutation occurs. Transaction/payment/order writes are never cached.
const HOT_READ_MIN_INTERVAL_MS = 30_000;
const HOT_READ_CACHE_MAX_ENTRIES = 64;
const hotReadCache = new Map<string, { expiresAt: number; response: Response }>();
const hotReadInFlight = new Map<string, Promise<Response>>();
let readScopeEpoch = 0;

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(input instanceof Request ? input.method : init?.method ?? "GET").toUpperCase();
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit) {
  return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}

function resolveUrl(input: RequestInfo | URL) {
  const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
  return new URL(rawUrl, window.location.origin);
}

function resolvePromptPayPath(input: RequestInfo | URL, init?: RequestInit): string | null {
  if (requestMethod(input, init) !== "GET") return null;

  try {
    const url = resolveUrl(input);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== PROMPTPAY_HOST) return null;
    if (!PROMPTPAY_PATH_PATTERN.test(url.pathname)) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function invalidateBudgetedReadsForMutation(input: RequestInfo | URL, init?: RequestInit) {
  if (requestMethod(input, init) === "GET") return;
  try {
    const url = resolveUrl(input);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return;
    // Performance telemetry is observational and must not defeat the read budget by
    // invalidating operational snapshots on every navigation/resource sample.
    if (url.pathname === "/api/pos/perf") return;
    readScopeEpoch += 1;
    hotReadCache.clear();
  } catch {
    // Invalid URLs fall through to the native fetch path.
  }
}

function resolveBudgetedReadKey(input: RequestInfo | URL, init?: RequestInit): string | null {
  if (requestMethod(input, init) !== "GET") return null;

  try {
    const url = resolveUrl(input);
    if (url.origin !== window.location.origin) return null;

    const prefix = `scope:${readScopeEpoch}:`;

    if (url.pathname === "/api/pos/tables") {
      return `${prefix}${url.pathname}${url.search}`;
    }
    if (/^\/api\/pos\/tables\/[^/]+\/bill$/.test(url.pathname)) {
      return `${prefix}${url.pathname}${url.search}`;
    }
    if (/^\/api\/pos\/tables\/[^/]+\/qr-orders$/.test(url.pathname)) {
      // The cursor changes after each successful read; key by table so cursor churn cannot
      // bypass the 30s request floor. The consumer already de-duplicates event ids.
      return `${prefix}${url.pathname}`;
    }
    if (/^\/api\/table-order\/[^/]+$/.test(url.pathname)) {
      const isStatusRead = url.searchParams.get("view") === "status" || url.searchParams.get("state") === "1";
      if (isStatusRead) return `${prefix}${url.pathname}?view=status`;
    }
  } catch {
    return null;
  }

  return null;
}

function trimHotReadCache(now: number) {
  for (const [key, entry] of hotReadCache) {
    if (entry.expiresAt <= now) hotReadCache.delete(key);
  }
  while (hotReadCache.size > HOT_READ_CACHE_MAX_ENTRIES) {
    const oldestKey = hotReadCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    hotReadCache.delete(oldestKey);
  }
}

async function fetchBudgetedRead(input: RequestInfo | URL, init: RequestInit | undefined, key: string) {
  const signal = requestSignal(input, init);
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  const now = Date.now();
  const cached = hotReadCache.get(key);
  if (cached && cached.expiresAt > now) return cached.response.clone();
  if (cached) hotReadCache.delete(key);

  const existing = hotReadInFlight.get(key);
  if (existing) return existing.then((response) => response.clone());

  const request = nativeFetch(input, init)
    .then((response) => {
      if (response.ok) {
        hotReadCache.set(key, {
          expiresAt: Date.now() + HOT_READ_MIN_INTERVAL_MS,
          response: response.clone()
        });
        trimHotReadCache(Date.now());
      }
      return response;
    })
    .finally(() => {
      hotReadInFlight.delete(key);
    });

  hotReadInFlight.set(key, request);
  return request.then((response) => response.clone());
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  invalidateBudgetedReadsForMutation(input, init);

  const promptPayPath = resolvePromptPayPath(input, init);
  if (promptPayPath) {
    const signal = requestSignal(input, init);
    return nativeFetch("/api/pos/promptpay-qr-proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "image/*"
      },
      body: JSON.stringify({ path: promptPayPath }),
      credentials: "same-origin",
      cache: "no-store",
      signal
    });
  }

  const budgetedReadKey = resolveBudgetedReadKey(input, init);
  if (budgetedReadKey) return fetchBudgetedRead(input, init, budgetedReadKey);

  return nativeFetch(input, init);
}) as typeof globalThis.fetch;

const nativeFetch = globalThis.fetch.bind(globalThis);
const PROMPTPAY_HOST = "promptpay.io";
const PROMPTPAY_PATH_PATTERN = /^\/(\d{9,15})\/(\d+(?:\.\d{1,2})?)\/?$/;
const PROMPTPAY_CACHE_TTL_MS = 120_000;

type CachedPromptPayImage = {
  blob: Blob;
  contentType: string;
  expiresAt: number;
};

const promptPayImageCache = new Map<string, CachedPromptPayImage>();
const promptPayPrefetches = new Map<string, Promise<CachedPromptPayImage | null>>();

function resolvePromptPayPath(input: RequestInfo | URL, init?: RequestInit): string | null {
  const method = String(input instanceof Request ? input.method : init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return null;

  try {
    const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    const url = new URL(rawUrl, window.location.origin);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== PROMPTPAY_HOST) return null;
    if (!PROMPTPAY_PATH_PATTERN.test(url.pathname)) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function readCachedPromptPayImage(path: string) {
  const cached = promptPayImageCache.get(path);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    promptPayImageCache.delete(path);
    return null;
  }
  return cached;
}

function responseFromCachedPromptPayImage(cached: CachedPromptPayImage) {
  return new Response(cached.blob, {
    status: 200,
    headers: {
      "Content-Type": cached.contentType,
      "Cache-Control": "private, no-store, max-age=0",
      "X-CpIPOS-PromptPay-Cache": "memory"
    }
  });
}

async function loadPromptPayImage(path: string): Promise<CachedPromptPayImage | null> {
  const cached = readCachedPromptPayImage(path);
  if (cached) return cached;

  const inFlight = promptPayPrefetches.get(path);
  if (inFlight) return inFlight;

  const prefetch = (async () => {
    const response = await nativeFetch("/api/pos/promptpay-qr-proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "image/*"
      },
      body: JSON.stringify({ path }),
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) return null;

    const blob = await response.blob();
    const contentType = String(blob.type || response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/") || blob.size <= 0) return null;

    const entry: CachedPromptPayImage = {
      blob,
      contentType,
      expiresAt: Date.now() + PROMPTPAY_CACHE_TTL_MS
    };
    promptPayImageCache.set(path, entry);
    return entry;
  })()
    .catch(() => null)
    .finally(() => {
      promptPayPrefetches.delete(path);
    });

  promptPayPrefetches.set(path, prefetch);
  return prefetch;
}

async function fetchPromptPayImage(path: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Request was aborted.", "AbortError");

  const cached = readCachedPromptPayImage(path);
  if (cached) return responseFromCachedPromptPayImage(cached);

  const prefetched = await loadPromptPayImage(path);
  if (signal?.aborted) throw new DOMException("Request was aborted.", "AbortError");
  if (prefetched) return responseFromCachedPromptPayImage(prefetched);

  return nativeFetch("/api/pos/promptpay-qr-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "image/*"
    },
    body: JSON.stringify({ path }),
    credentials: "same-origin",
    cache: "no-store",
    signal
  });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const promptPayPath = resolvePromptPayPath(input, init);
  if (!promptPayPath) return nativeFetch(input, init);

  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return fetchPromptPayImage(promptPayPath, signal);
}) as typeof globalThis.fetch;

function prefetchPromptPayImageElement(image: HTMLImageElement) {
  const source = image.currentSrc || image.src;
  if (!source) return;
  const path = resolvePromptPayPath(source);
  if (path) void loadPromptPayImage(path);
}

function prefetchPromptPayImages(root: Document | Element) {
  if (root instanceof HTMLImageElement) prefetchPromptPayImageElement(root);
  root.querySelectorAll<HTMLImageElement>('img[src*="promptpay.io"]').forEach(prefetchPromptPayImageElement);
}

function startPromptPayPrefetchObserver() {
  prefetchPromptPayImages(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.target instanceof HTMLImageElement) {
        prefetchPromptPayImageElement(mutation.target);
      }
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement) {
          prefetchPromptPayImageElement(node);
        } else if (node instanceof Element) {
          prefetchPromptPayImages(node);
        }
      });
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"]
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startPromptPayPrefetchObserver, { once: true });
  } else {
    queueMicrotask(startPromptPayPrefetchObserver);
  }
}

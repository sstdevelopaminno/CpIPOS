const nativeFetch = globalThis.fetch.bind(globalThis);
const PROMPTPAY_HOST = "promptpay.io";
const PROMPTPAY_PATH_PATTERN = /^\/(\d{9,15})\/(\d+(?:\.\d{1,2})?)\/?$/;

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

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const promptPayPath = resolvePromptPayPath(input, init);
  if (!promptPayPath) return nativeFetch(input, init);

  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
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
}) as typeof globalThis.fetch;

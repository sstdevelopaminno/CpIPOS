type NativePrintBridge = {
  notifyPrintQueued?: () => void;
};

type WindowWithNativePrint = Window & {
  CpiposPrint?: NativePrintBridge;
  __cpiposNativePrintAutoWakeInstalled?: boolean;
};

let lastNativePrintWakeAt = 0;
const NATIVE_PRINT_WAKE_DEDUPE_MS = 120;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "";
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const explicit = String(init?.method ?? "").trim();
  if (explicit) return explicit.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function requestPathname(input: RequestInfo | URL): string {
  const raw = requestUrl(input);
  if (!raw) return "";
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://cpipos.local";
    return new URL(raw, base).pathname;
  } catch {
    return raw.split("?", 1)[0] ?? "";
  }
}

export function shouldWakeNativePrintAgent(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (requestMethod(input, init) !== "POST") return false;
  const path = requestPathname(input);

  if (
    path === "/api/pos/sales" ||
    path === "/api/pos/payments" ||
    path === "/api/pos/payment-notice" ||
    path === "/api/pos/cash-drawer/open" ||
    path === "/api/pos/receipts" ||
    path.startsWith("/api/pos/receipts/")
  ) {
    return true;
  }

  return /^\/api\/pos\/orders\/[^/]+\/(?:kitchen-dispatch|cancel|pay)$/.test(path);
}

export function wakeNativePrintAgent(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastNativePrintWakeAt < NATIVE_PRINT_WAKE_DEDUPE_MS) return;
  lastNativePrintWakeAt = now;

  try {
    (window as WindowWithNativePrint).CpiposPrint?.notifyPrintQueued?.();
  } catch {
    // Browser/PWA and older Android builds do not expose the native bridge.
  }
}

export function installNativePrintAutoWake(): void {
  if (typeof window === "undefined") return;
  const target = window as WindowWithNativePrint;
  if (target.__cpiposNativePrintAutoWakeInstalled) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);
    if (response.ok && shouldWakeNativePrintAgent(input, init)) {
      wakeNativePrintAgent();
    }
    return response;
  };
  target.__cpiposNativePrintAutoWakeInstalled = true;
}

// PosSalesModule already imports this module on the Android POS sales surface. Installing the
// wrapper here keeps every print-producing fetch in the same WebView on the low-latency wake path,
// including nested components such as Table QR, without changing browser/PWA behavior.
installNativePrintAutoWake();

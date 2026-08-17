type NativePrintBridge = {
  notifyPrintQueued?: () => void;
};

type WindowWithNativePrint = Window & {
  CpiposPrint?: NativePrintBridge;
};

export function wakeNativePrintAgent(): void {
  if (typeof window === "undefined") return;
  try {
    (window as WindowWithNativePrint).CpiposPrint?.notifyPrintQueued?.();
  } catch {
    // Browser/PWA and older Android builds do not expose the native bridge.
  }
}

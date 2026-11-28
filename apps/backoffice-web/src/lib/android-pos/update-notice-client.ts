// Only the installed CpiPOS Android POS wrapper receives update notices.
// Screen size alone cannot distinguish a tablet app from Windows or browser PWA.
// This is UI targeting, not an authentication or authorization boundary.
export function isAndroidTabletUpdateClient(userAgent: string): boolean {
  return /\\bAndroid\\b/i.test(userAgent) && !/\\bWindows\\b/i.test(userAgent) &&
    /(?:^|\\s)CpIPOS-AndroidPOS\\/\\d+(?:\\.\\d+)+(?:\\s|$)/i.test(userAgent);
}

export function shouldShowAndroidTabletUpdateNotice(): boolean {
  return typeof navigator !== "undefined" && isAndroidTabletUpdateClient(navigator.userAgent);
}

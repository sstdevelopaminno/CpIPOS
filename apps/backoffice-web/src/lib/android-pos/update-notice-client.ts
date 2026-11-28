// Only the installed CpiPOS Android POS wrapper receives update notices.
// Screen size alone cannot distinguish a tablet app from Windows or browser PWA.
// This is UI targeting, not an authentication or authorization boundary.
export function isAndroidTabletUpdateClient(userAgent: string): boolean {
  const tokens = userAgent.split(" ").filter(Boolean);
  const nativeToken = tokens.find(token => token.toLowerCase().startsWith("cpipos-androidpos/"));
  return userAgent.includes("Android") && !userAgent.includes("Windows") &&
    Boolean(nativeToken && /^[0-9]+([.][0-9]+)+$/.test(nativeToken.slice("CpIPOS-AndroidPOS/".length)));
}

export function shouldShowAndroidTabletUpdateNotice(): boolean {
  return typeof navigator !== "undefined" && isAndroidTabletUpdateClient(navigator.userAgent);
}

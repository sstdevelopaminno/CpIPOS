/**
 * Zone tabs are buttons inside a horizontally scrollable container.
 * Never capture a pointer that began on a tab button: Windows WebView2
 * and Android WebView retarget synthesized clicks to the capture owner.
 * Touch/pen scroll natively via CSS overflow-x and touch-action: pan-x.
 */
export function shouldCaptureTableZoneBackgroundDrag(input: {
  pointerType: string;
  button: number;
  targetIsContainer: boolean;
}): boolean {
  return input.pointerType === "mouse" && input.button === 0 && input.targetIsContainer;
}

/**
 * Product-code fields are ASCII. Hardware HID scanners follow the host keyboard
 * layout, so on a Thai Windows layout the physical KeyA/Digit1 can emit Thai
 * glyphs. Only remap non-ASCII key values and only inside the barcode field;
 * never change the OS language, global keyboard handlers, or normal typing.
 */
export function asciiKeyFromScannerCode(code: string, key: string, shift: boolean): string | null {
  if (!key || key.length !== 1) return null;
  // Some Thai layouts output ASCII "/" and "-" for the physical Digit2/3.
  // Map numeric scan keys before the ASCII pass-through check, otherwise
  // a valid 1234 barcode becomes 1/-4 without a visible error.
  if (/^Digit[0-9]$/.test(code) && !shift) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  // Hardware Code128 may use Shift+Minus to transmit an underscore in SKU.
  if (code === "Minus") return shift ? "_" : "-";
  if (code === "NumpadSubtract") return "-";
  if (/^[\x20-\x7e]$/.test(key)) return null;
  if (/^Key[A-Z]$/.test(code)) {
    const c = code.slice(3);
    return shift ? c : c.toLowerCase();
  }
  if (code === "Minus" || code === "NumpadSubtract") return "-";
  if (code === "Period" || code === "NumpadDecimal") return ".";
  if (code === "Slash" || code === "NumpadDivide") return "/";
  return null;
}

export function validatedGroceryScanQuantity(input: unknown): number | null {
  const raw = String(input ?? "").trim();
  if (!/^[0-9]{1,4}$/.test(raw)) return null;
  const quantity = Number(raw);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 9999 ? quantity : null;
}

/** Empty scanner field (or quantity field) only. Keep physical Thai-layout
 * digit keys as barcode digits; never reinterpret a hyphen inside a SKU.
 * A leading literal +/- SKU can still be entered by paste.
 */
export function retailQuantityShortcut(event: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "isComposing">, barcodeValue: string): -1 | 1 | null {
  if (barcodeValue.length !== 0 || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return null;
  // Thai layouts can emit '-' for Digit3. It is still a scanner digit.
  if (/^(Digit|Numpad)[0-9]$/.test(event.code)) return null;
  if (event.code === "NumpadAdd" || (event.code === "Equal" && event.shiftKey) || event.key === "+") return 1;
  if (event.code === "NumpadSubtract" || (event.code === "Minus" && !event.shiftKey) || event.key === "-") return -1;
  return null;
}
export function stepRetailScanQuantity(value: unknown, delta: -1 | 1): number {
  return Math.max(1, Math.min(9999, (validatedGroceryScanQuantity(value) ?? 1) + delta));
}
export function shouldResetRetailScanQuantity(acceptedRevision: number, currentRevision: number): boolean {
  return acceptedRevision === currentRevision;
}

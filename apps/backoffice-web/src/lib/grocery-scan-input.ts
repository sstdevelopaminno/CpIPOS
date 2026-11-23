/**
 * Product-code fields are ASCII. Hardware HID scanners follow the host keyboard
 * layout, so on a Thai Windows layout the physical KeyA/Digit1 can emit Thai
 * glyphs. Only remap non-ASCII key values and only inside the barcode field;
 * never change the OS language, global keyboard handlers, or normal typing.
 */
export function asciiKeyFromScannerCode(code: string, key: string, shift: boolean): string | null {
  if (!key || key.length !== 1 || /^[\x20-\x7e]$/.test(key)) return null;
  if (/^Key[A-Z]$/.test(code)) {
    const c = code.slice(3);
    return shift ? c : c.toLowerCase();
  }
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
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

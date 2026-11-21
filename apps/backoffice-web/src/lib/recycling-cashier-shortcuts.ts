/**
 * CUSTOM Recycling cashier shortcuts use physical key positions so that
 * Thai/English keyboard layouts behave identically. Do not attach these
 * shortcuts to the ordinary POS workspace.
 *
 * A scanner can produce the same leading W/A/D bytes as a cashier keyboard.
 * Callers must disambiguate a single idle key from the start of a barcode
 * before performing the action.
 */
export type RecyclingCashierShortcut = "w" | "a" | "d";

// Typical HID scanner characters arrive much faster than a human key press.
// A short wait preserves barcodes starting with W, A or D (including one-byte
// barcodes terminated with Enter). It is not a scanner identity guarantee.
export const RECYCLING_SHORTCUT_DELAY_MS = 180;

export function recyclingCashierShortcutFromCode(code: string): RecyclingCashierShortcut | null {
  switch (code) {
    case "KeyW": return "w";
    case "KeyA": return "a";
    case "KeyD": return "d";
    default: return null;
  }
}

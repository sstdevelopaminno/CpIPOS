import { describe, expect, it } from "vitest";
import { asciiKeyFromScannerCode, validatedGroceryScanQuantity } from "../../src/lib/grocery-scan-input";

describe("Grocery hardware scanner with Thai keyboard layout", () => {
  it("accepts physical A-Z and digits without changing the user's OS language", () => {
    expect(asciiKeyFromScannerCode("KeyA", "ฟ", false)).toBe("a");
    expect(asciiKeyFromScannerCode("KeyQ", "ๆ", true)).toBe("Q");
    expect(asciiKeyFromScannerCode("Digit1", "ๅ", false)).toBe("1");
    expect(asciiKeyFromScannerCode("Digit2", "/", false)).toBe("2");
    expect(asciiKeyFromScannerCode("Digit3", "-", false)).toBe("3");
    expect(asciiKeyFromScannerCode("Digit2", "@", true)).toBeNull();
    expect(asciiKeyFromScannerCode("Numpad5", "๕", false)).toBe("5");
    expect(asciiKeyFromScannerCode("Minus", "ข", false)).toBe("-");
    expect(asciiKeyFromScannerCode("KeyA", "a", false)).toBeNull();
    expect(asciiKeyFromScannerCode("KeyA", "Enter", false)).toBeNull();
  });
  it("adds one or more units only on valid whole-number quantity", () => {
    expect(validatedGroceryScanQuantity("1")).toBe(1);
    expect(validatedGroceryScanQuantity("5")).toBe(5);
    expect(validatedGroceryScanQuantity("9999")).toBe(9999);
    for(const invalid of ["", "0", "-1", "2.5", "10000", "aaa", "1e4"]) {
      expect(validatedGroceryScanQuantity(invalid)).toBeNull();
    }
  });
});

import { describe, expect, it } from "vitest";
import { appendBuffetQuantityKey } from "../../src/lib/pos-buffet-pricing";

describe("Buffet quantity keypad", () => {
  it("replaces the visual default 1 with the first real digit", () => {
    expect(appendBuffetQuantityKey("1", "5", true)).toBe("5");
    expect(appendBuffetQuantityKey("1", "1", true)).toBe("1");
  });

  it("appends digits normally after the first real key", () => {
    expect(appendBuffetQuantityKey("1", "9", false)).toBe("19");
    expect(appendBuffetQuantityKey("12", "3", false)).toBe("123");
  });

  it("keeps the POS quantity input within three digits and normalizes leading zeros", () => {
    expect(appendBuffetQuantityKey("123", "4", false)).toBe("123");
    expect(appendBuffetQuantityKey("1", "00", true)).toBe("0");
    expect(appendBuffetQuantityKey("0", "5", false)).toBe("5");
  });
});

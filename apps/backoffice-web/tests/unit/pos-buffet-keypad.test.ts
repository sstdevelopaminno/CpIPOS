import { describe, expect, it } from "vitest";
import { adjustBuffetQuantity, selectBuffetQuickQuantity } from "../../src/lib/pos-buffet-pricing";

describe("Buffet quantity selector", () => {
  it("uses 1-9 as exact quantities instead of concatenating digits", () => {
    expect(selectBuffetQuickQuantity(1)).toBe(1);
    expect(selectBuffetQuickQuantity(2)).toBe(2);
    expect(selectBuffetQuickQuantity(3)).toBe(3);
    expect(selectBuffetQuickQuantity(9)).toBe(9);
  });

  it("increments beyond 9 with the plus control", () => {
    expect(adjustBuffetQuantity(9, 1)).toBe(10);
    expect(adjustBuffetQuantity(10, 1)).toBe(11);
    expect(adjustBuffetQuantity(11, 1)).toBe(12);
  });

  it("decrements safely and never falls below one", () => {
    expect(adjustBuffetQuantity(10, -1)).toBe(9);
    expect(adjustBuffetQuantity(1, -1)).toBe(1);
  });

  it("caps operator quantity at 999", () => {
    expect(adjustBuffetQuantity(999, 1)).toBe(999);
    expect(selectBuffetQuickQuantity(5000)).toBe(999);
  });
});

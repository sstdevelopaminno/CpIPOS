import { describe, expect, it } from "vitest";
import { DEFAULT_POS_SALES_MODES, normalizePosSalesModes, normalizeCustomPosSalesModes, isCustomCashierModeEnabled, posUiModeToControlKey } from "../../src/lib/pos-sales-modes";

describe("IT controlled POS sales modes", () => {
  it("preserves existing modes and keeps CUSTOM Recycling disabled by default", () => {
    expect(normalizePosSalesModes(null)).toEqual(DEFAULT_POS_SALES_MODES);
    expect(Object.keys(DEFAULT_POS_SALES_MODES)).toEqual(["takeaway", "dine_in", "buffet_table", "delivery", "general_sale", "optical_retail", "recycling"]);
  });

  it("honors explicit false values written by the IT Control Plane", () => {
    expect(normalizePosSalesModes({ takeaway: false, general_sale: false })).toEqual({
      takeaway: false,
      dine_in: true,
      buffet_table: true,
      delivery: true,
      general_sale: false,
      optical_retail: false,
      recycling: false
    });
  });

  it("does not expose Optical for fixed packages and requires explicit CUSTOM grant", () => {
    expect(normalizePosSalesModes(null).optical_retail).toBe(false);
    expect(normalizeCustomPosSalesModes(null).optical_retail).toBe(false);
    expect(normalizeCustomPosSalesModes({ optical_retail: true }).optical_retail).toBe(true);
    expect(normalizeCustomPosSalesModes({ general_sale: true }).optical_retail).toBe(false);
    expect(normalizePosSalesModes(null).recycling).toBe(false);
    expect(normalizeCustomPosSalesModes({ recycling: true }).recycling).toBe(true);
    expect(normalizeCustomPosSalesModes({ general_sale: true }).recycling).toBe(false);
  });

  it("preserves independently approved CUSTOM cashier modes after the main hotfix", () => {
    expect(isCustomCashierModeEnabled(null)).toBe(false);
    expect(isCustomCashierModeEnabled({ general_sale: false, optical_retail: false, recycling: false })).toBe(false);
    expect(isCustomCashierModeEnabled({ takeaway: true })).toBe(false);
    expect(isCustomCashierModeEnabled({ general_sale: true })).toBe(true);
    expect(isCustomCashierModeEnabled({ optical_retail: true })).toBe(true);
    expect(isCustomCashierModeEnabled({ recycling: true })).toBe(true);
    expect(isCustomCashierModeEnabled({ recycling: "true" })).toBe(false);
  });

  it("maps the customer selector mode ids to the canonical IT keys", () => {
    expect(posUiModeToControlKey("home")).toBe("takeaway");
    expect(posUiModeToControlKey("dine_in")).toBe("dine_in");
    expect(posUiModeToControlKey("buffet_table")).toBe("buffet_table");
    expect(posUiModeToControlKey("delivery")).toBe("delivery");
    expect(posUiModeToControlKey("general_sale")).toBe("general_sale");
    expect(posUiModeToControlKey("optical_retail")).toBe("optical_retail");
    expect(posUiModeToControlKey("recycling")).toBe("recycling");
    expect(posUiModeToControlKey("unknown")).toBeNull();
  });
});

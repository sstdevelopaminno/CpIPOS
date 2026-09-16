import { describe, expect, it } from "vitest";
import { DEFAULT_POS_SALES_MODES, normalizePosSalesModes, posUiModeToControlKey } from "../../src/lib/pos-sales-modes";

describe("IT controlled POS sales modes", () => {
  it("keeps all five customer POS modes enabled when no IT override exists", () => {
    expect(normalizePosSalesModes(null)).toEqual(DEFAULT_POS_SALES_MODES);
    expect(Object.keys(DEFAULT_POS_SALES_MODES)).toEqual(["takeaway", "dine_in", "buffet_table", "delivery", "general_sale"]);
  });

  it("honors explicit false values written by the IT Control Plane", () => {
    expect(normalizePosSalesModes({ takeaway: false, general_sale: false })).toEqual({
      takeaway: false,
      dine_in: true,
      buffet_table: true,
      delivery: true,
      general_sale: false
    });
  });

  it("maps the customer selector mode ids to the canonical IT keys", () => {
    expect(posUiModeToControlKey("home")).toBe("takeaway");
    expect(posUiModeToControlKey("dine_in")).toBe("dine_in");
    expect(posUiModeToControlKey("buffet_table")).toBe("buffet_table");
    expect(posUiModeToControlKey("delivery")).toBe("delivery");
    expect(posUiModeToControlKey("general_sale")).toBe("general_sale");
    expect(posUiModeToControlKey("unknown")).toBeNull();
  });
});

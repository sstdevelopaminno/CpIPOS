import { describe, expect, it } from "vitest";
import { validateNativeSaleLine } from "../../src/lib/services/native-mobile-modifier-pricing";

const PRODUCT = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const OPT1 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const OPT2 = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

const product = { id: PRODUCT, price: 65, is_active: true, metadata: { special_price: 50 } };
const group = { id: "g", product_id: PRODUCT, name: "เส้น", selection_type: "single" as const,
  is_required: true, min_select: 1, max_select: 1 };
const options = [
  { id: OPT1, group_id: "g", name: "เส้นเล็ก", price_delta: 0 },
  { id: OPT2, group_id: "g", name: "เส้นหมี่", price_delta: 5 }
];

function item(selected: string[], kind: "regular" | "special" = "regular", price?: number) {
  return { product_id: PRODUCT, quantity: 2, unit_price: price,
    native_selection: { cart_line_id: PRODUCT + ":unique", price_kind: kind,
      modifier_option_ids: selected, note: "ไม่เผ็ด" } };
}

describe("Native Mobile canonical configured sale price", () => {
  it("computes special price and option delta under server control", () => {
    const result = validateNativeSaleLine(item([OPT2], "special", 55), product, [group], options);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items).toEqual([{
      product_id: PRODUCT, quantity: 2, unit_price: 55, notes: "ราคาพิเศษ | เส้นหมี่ | ไม่เผ็ด",
      native_selection: item([OPT2], "special", 55).native_selection
    }]);
  });

  it("rejects missing required selections and unregistered option ids", () => {
    expect(validateNativeSaleLine(item([]), product, [group], options)).toMatchObject({
      ok: false, code: "required_modifier_selection_missing"
    });
    expect(validateNativeSaleLine(item(["dddddddd-dddd-4ddd-dddd-dddddddddddd"]), product, [group], options)).toMatchObject({
      ok: false, code: "invalid_modifier_option"
    });
  });

  it("rejects client price overrides and disabled special price", () => {
    expect(validateNativeSaleLine(item([OPT1], "special", 1), product, [group], options)).toMatchObject({
      ok: false, code: "native_price_changed_refresh_required"
    });
    expect(validateNativeSaleLine(item([OPT1], "special", 65),
      {...product, metadata: {}}, [group], options)).toMatchObject({
      ok: false, code: "special_price_not_configured"
    });
  });
});

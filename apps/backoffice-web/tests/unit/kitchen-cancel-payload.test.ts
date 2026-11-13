import { describe, expect, it } from "vitest";
import {
  buildKitchenCancellationRemainingLines,
  type KitchenCancellationOrderLine
} from "../../src/lib/services/kitchen-cancel-payload";

const native = (id: string, cartLineId: string): KitchenCancellationOrderLine => ({
  id, product_id: `product-${id}`, quantity: 1, unit_price: 65, line_total: 65,
  notes: "ใส่ไข่", metadata: { native_selection: {
    cart_line_id: cartLineId, price_kind: "regular", modifier_option_ids: [], note: "ใส่ไข่"
  } }
});

describe("Kitchen cancellation replacement payload", () => {
  it("keeps the original Native selection and cart identity of remaining lines", () => {
    const result = buildKitchenCancellationRemainingLines(
      [native("a", "line-a"), native("b", "line-b")], "a");
    expect(result).toEqual({ ok: true, lines: [{
      product_id: "product-b", quantity: 1, unit_price: 65, line_total: 65,
      notes: "ใส่ไข่", note: "ใส่ไข่",
      native_selection: { cart_line_id: "line-b", price_kind: "regular",
        modifier_option_ids: [], note: "ใส่ไข่" }
    }] });
  });

  it("allows cancelling the final Native line without inventing a new line", () => {
    expect(buildKitchenCancellationRemainingLines([native("a", "line-a")], "a"))
      .toEqual({ ok: true, lines: [] });
  });

  it("rejects mixed bills before the RPC can rewrite legacy lines", () => {
    const legacy: KitchenCancellationOrderLine = {
      ...native("b", "unused"), notes: null, metadata: null
    };
    expect(buildKitchenCancellationRemainingLines([native("a", "line-a"), legacy], "a"))
      .toEqual({ ok: false, code: "kitchen_cancel_mixed_native_bill_unsupported" });
  });

  it("rejects duplicate Native cart identities", () => {
    expect(buildKitchenCancellationRemainingLines(
      [native("a", "line-a"), native("b", "line-b"), native("c", "line-b")], "a"))
      .toEqual({ ok: false, code: "kitchen_cancel_native_snapshot_invalid" });
  });
});

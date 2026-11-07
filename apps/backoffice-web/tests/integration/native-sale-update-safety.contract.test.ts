import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src/app/api/pos/sales/route.ts", import.meta.url), "utf8");
const post = source.slice(source.indexOf("export async function POST(req: Request)"));

describe("Native Mobile sale route fail-closed guardrails", () => {
  it("rejects unvalidated option payloads from the Web checkout path", () => {
    expect(post).toContain('body.native_mobile !== true && body.items.some');
    expect(post).toContain('Object.prototype.hasOwnProperty.call(item, "native_selection")');
    expect(post).toContain('"native_selection_requires_mobile_contract"');
    expect(post.indexOf('"native_selection_requires_mobile_contract"'))
      .toBeLessThan(post.indexOf("const pricing = await resolveOrderPricing"));
  });

  it("rejects Native takeaway edits before the legacy non-atomic line replacement", () => {
    expect(post).toContain('body.native_mobile === true && body.order_id && body.order_type !== "dine_in"');
    expect(post).toContain('"native_atomic_order_update_required"');
    expect(post.indexOf('"native_atomic_order_update_required"'))
      .toBeLessThan(post.indexOf("const pricing = await resolveOrderPricing"));
    expect(post.indexOf('"native_atomic_order_update_required"'))
      .toBeLessThan(post.indexOf("const updated = await updateQueuedPosOrder"));
  });

  it("never recreates a Native sale when its queued order is missing or not editable", () => {
    expect(post).toContain('normalizedBody.native_mobile !== true && normalizedBody.order_type !== "dine_in"');
    expect(post).toContain('updated.code === "order_not_updatable" || updated.code === "order_not_found"');
  });

  it("still routes valid Native new sales through server-authoritative price resolution and the atomic create service", () => {
    expect(post).toContain("const checked = await resolveNativeMobileSaleLines");
    expect(post).toContain("if (!checked.ok) return fail(checked.code, checked.code, checked.status)");
    expect(post).toContain("const result = await executeCreatePosOrderTransaction");
  });
});

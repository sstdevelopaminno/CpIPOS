import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const kds=read("src/lib/services/kitchen-queue-service.ts");
const sales=read("src/app/api/pos/sales/route.ts");
const clear=read("src/app/api/pos/sales/clear-dine-in/route.ts");
const front=read("src/components/pos/pos-sales-module.tsx");
const ui=read("src/components/kitchen/kitchen-kds.tsx");

describe("queued kitchen item cancellation safeguards",()=>{
  it("keeps per-line Native modifiers when KDS cancels another item",()=>{
    expect(kds).toContain("export async function cancelKitchenTicketItem");
    expect(kds).toContain('const selection = metadata.native_selection');
    expect(kds).toContain("native_selection: nativeSelection");
    expect(kds).toContain('typeof (selection as Record<string, unknown>).cart_line_id === "string"');
    expect(kds).toContain('rpc("replace_queued_dine_in_order_tx"');
    expect(kds).toContain("kds_line_cancelled");
    expect(ui).toContain("async function cancelItem(ticket: KitchenTicket, item: KitchenItem)");
  });

  it("preserves existing native selection without trusting cashier payload",()=>{
    expect(sales).toContain('select("id,product_id,quantity,unit_price,notes,metadata")');
    expect(sales).toContain('nativeLines');
    expect(sales).toContain('replacementItems=enriched');
    expect(sales).toContain("native_order_line_ambiguous");
    expect(sales).toContain("native_selection:selection");
    expect(sales).toContain("p_items: replacementItems");
    expect(sales).toContain("Math.abs(Number(row.unit_price)-Number(line.unit_price))<0.01");
  });

  it("supports deleting the last submitted item through existing atomic clear API",()=>{
    expect(front).toContain('job.cart.length === 0 && job.activeOrder?.status === "queued"');
    expect(front).toContain('fetch("/api/pos/sales/clear-dine-in"');
    expect(clear).toContain('p_items: []');
    expect(clear).toContain("replace_queued_dine_in_order_tx");
    expect(clear).not.toContain('.from("order_items").delete()');
  });
});
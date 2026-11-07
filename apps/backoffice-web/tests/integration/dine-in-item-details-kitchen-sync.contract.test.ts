import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

const sales = read("../../src/components/pos/pos-sales-module.tsx");
const kitchen = read("../../src/components/kitchen/kitchen-kds.tsx");
const receipt = read("../../src/lib/printing/receipt-html-template.ts");
const kitchenTicket = read("../../src/lib/printing/kitchen-ticket-html-template.ts");

describe("dine-in per-item details and kitchen cancellation sync contract", () => {
  it("respects the optional popup setting while preserving recipe and kitchen details", () => {
    expect(sales).toContain('if ((orderType === "dine_in" || product.has_recipe_deduction || hasSpecialPrice)');
    expect(sales).toContain("shouldOpenPosItemDetailPopup(product, itemDetailPopupEnabled)");
    expect(sales).toContain('detailNote: ""');
    expect(sales).toContain('localSaleLabel("รายละเอียดอื่นๆ ต่อรายการสินค้า", "Other item details")');
    expect(sales).toContain("composePosItemNotes(modifierDraft.notes, modifierDraft.detailNote)");
  });

  it("keeps active dine-in bills near-real-time without polling every table", () => {
    expect(sales).toContain("const ACTIVE_TABLE_BILL_SYNC_INTERVAL_MS = 2000;");
    expect(sales).toContain("loadTableBillContextRef.current(table, { lite: true })");
    expect(sales).toContain("window.setInterval(refreshActiveTableBill, ACTIVE_TABLE_BILL_SYNC_INTERVAL_MS)");
    expect(sales).toContain('orderType !== "dine_in" || tableBrowserOpen || !selectedTable?.id || !activeOrder?.id');
  });

  it("renders structured details in Kitchen and receipt outputs", () => {
    expect(kitchen).toContain('parsePosItemNotes(item.notes)');
    expect(kitchen).toContain('kt(lang, "itemDetail")');
    expect(receipt).toContain("parsePosItemNotes(item.note)");
    expect(receipt).toContain('L("รายละเอียด", "Details", "ລາຍລະອຽດ")');
    expect(kitchenTicket).toContain("parsePosItemNotes(item.notes)");
  });
});

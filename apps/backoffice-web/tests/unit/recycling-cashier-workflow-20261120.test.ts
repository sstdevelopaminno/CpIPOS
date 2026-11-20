import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRecyclingBarcodeIndex, resolveRecyclingBarcode } from "@/lib/recycling-barcode-index";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const cashier = src("src/components/pos/recycling-pos-workspace.tsx");
const toolbar = src("src/components/pos/recycling-sales-mode-switcher.tsx");
const postApi = src("src/app/api/pos/recycling/transactions/route.ts");
const printApi = src("src/app/api/pos/recycling/receipts/[id]/print/route.ts");

describe("Recycling custom cashier UX", () => {
  it("uses exact indexed barcodes instead of fuzzy searching", () => {
    const steel = {sku:"00125", id:"steel"};
    const paper = {sku:"P-011", id:"paper"};
    const idx = buildRecyclingBarcodeIndex([steel, paper]);
    expect(resolveRecyclingBarcode(idx,"00125")).toEqual({status:"found",item:steel});
    expect(resolveRecyclingBarcode(idx,"p-011 ")).toEqual({status:"found",item:paper});
    expect(resolveRecyclingBarcode(idx,"125")).toEqual({status:"missing"});
    expect(resolveRecyclingBarcode(idx,"P-0")).toEqual({status:"missing"});
  });
  it("rejects ambiguous duplicate SKUs (cannot charge wrong product)", () => {
    const idx=buildRecyclingBarcodeIndex([{sku:"ABC"},{sku:"abc "},{sku:""}]);
    expect(resolveRecyclingBarcode(idx,"AbC")).toEqual({status:"duplicate"});
    expect(resolveRecyclingBarcode(idx,"")).toEqual({status:"missing"});
  });
  it("adds countable scans immediately but requires scale weight confirmation", () => {
    expect(cashier).toContain('if (product.priceBasis === "piece")');
    expect(cashier).toContain('addLineToCart(product, "piece", 1, price)');
    expect(cashier).toContain("openQuantityPopup(product);");
    expect(cashier).toContain('setQuantity(item.priceBasis === "piece" ? "1" : "")');
    expect(cashier).toContain("resolveRecyclingBarcode(barcodeIndex, search)");
  });
  it("uses single compact native header, moves buy/sell buttons into it, drops redundant action stripe", () => {
    expect(toolbar).toContain("recycling-compact-toolbar");
    expect(toolbar).toContain("<PosSalesMetaDetails");
    expect(toolbar).toContain("onDirectionChange(value)");
    expect(cashier).not.toContain("recycling-sales-actions");
    expect(cashier).toContain('flex h-full min-h-0 w-full flex-col');
    expect(cashier).not.toContain('max-w-[1550px]');
    expect(cashier).not.toContain('grid grid-cols-2 gap-2 rounded-xl');
  });
  it("opens payment dialog before post, never enables unverified bank transfer", () => {
    expect(cashier).toContain('setCheckoutOpen(true)');
    expect(cashier).toContain('disabled={!transactionWritesEnabled || posting || !counterpartyName.trim()');
    expect(cashier).toContain('disabled={posting || checkoutOpen}');
    expect(cashier).toContain('aria-labelledby="recycling-checkout-title"');
    expect(cashier).toContain('role="dialog"');
    expect(cashier).toContain('if (settlement === "bank_transfer")');
    expect(cashier).toContain('name="recycling-settlement" disabled');
    expect(postApi).toContain('raw.settlement === "bank_transfer"');
    expect(cashier).not.toContain("void postTransaction()}");
  });
  it("queues print only AFTER confirmed atomic posting with stable retry id", () => {
    expect(cashier).toContain("await queueReceiptPrint(committedId, currentRequestId)");
    expect(cashier).toContain("printRequestId: currentRequestId");
    expect(cashier).toContain("queueReceiptPrint(posted.id, posted.printRequestId)");
    expect(cashier).toContain("บันทึกธุรกรรมสำเร็จ แต่ส่งคำสั่งพิมพ์ไม่สำเร็จ");
    expect(printApi).toContain("queueRoutedRecyclingReceipt");
  });
  it("never hardcodes the acceptance shop as a tenant entitlement", () => {
    expect(cashier).not.toContain("155858");
    expect(toolbar).not.toContain("155858");
  });
});

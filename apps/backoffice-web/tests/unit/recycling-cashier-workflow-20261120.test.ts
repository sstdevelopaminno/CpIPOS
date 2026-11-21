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
    expect(cashier).toContain("resolveRecyclingBarcode(barcodeIndex, normalized)");
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
  it("keeps Recycling flush to the viewport, with unified panels and a bottom summary dock", () => {
    const css=src("src/app/globals.css");
    expect(cashier).toContain('className="recycling-pos-layout flex h-full min-h-0 w-full flex-col');
    expect(cashier).toContain('data-testid="recycling-unified-sales-body"');
    expect(cashier).toContain('data-testid="recycling-anchored-summary"');
    expect(cashier).toContain('recycling-cart-scroll mt-3 min-h-0 flex-1 overflow-auto');
    expect(cashier).toContain('recycling-summary-dock mt-auto shrink-0');
    expect(css).toContain(".pos-app-content-area:has(> .recycling-pos-layout)");
    expect(css).toContain("padding: 0 !important");
    expect(css).toContain("grid-template-columns: minmax(310px, 42%) minmax(0, 1fr)");
    expect(css).toContain("border-left: 1px solid #e2e8f0 !important");
    expect(css).toContain("margin-top: auto");
    expect(cashier).not.toContain('min-h-[560px]');
  });
  it("aligns shared header labels and values in stable grid rows", () => {
    const css=src("src/app/globals.css");
    expect(toolbar).toContain("recycling-pos-toolbar posui-sales-topbar");
    expect(toolbar).toContain("<PosSalesMetaDetails");
    expect(toolbar).not.toContain("compactMetaCss");
    expect(css).toContain(".recycling-pos-toolbar .posui-sales-meta-columns");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr)) !important");
    expect(css).toContain(".recycling-pos-toolbar .posui-sales-meta-row");
    expect(css).toContain("display: grid !important");
  });
  it("opens payment dialog before post, never enables unverified bank transfer", () => {
    expect(cashier).toContain('setCheckoutOpen(true)');
    expect(cashier).toContain('disabled={!canUseShift || !transactionWritesEnabled || posting || settlement === "bank_transfer"');
    expect(cashier).toContain('disabled={!canUseShift || posting || checkoutOpen}');
    expect(cashier).toContain('aria-labelledby="recycling-checkout-title"');
    expect(cashier).toContain('role="dialog"');
    expect(cashier).toContain('if (settlement === "bank_transfer")');
    expect(cashier).toContain('checked={settlement==="bank_transfer"}');
    expect(cashier).toContain('settlement === "bank_transfer" || !visibleLines.length');
    expect(cashier).not.toContain('setSettlement("credit")');
    expect(postApi).toContain('raw.settlement === "bank_transfer"');
    expect(cashier).not.toContain("void postTransaction()}");
  });
  it("uses payout popup for buying and customer payment popup for selling", () => {
    expect(cashier).toContain('direction === "buy" ? "จ่ายเงิน" : "ชำระเงิน"');
    expect(cashier).toContain('direction === "buy" ? "วิธีจ่ายเงิน" : "วิธีรับชำระเงิน"');
    expect(cashier).toContain('direction==="buy"?"จ่ายเงินสด":"ชำระเงินสด"');
    expect(cashier).toContain('direction==="buy"?"จ่ายเงินโอน":"ชำระเงินโอน"');
    expect(cashier).toContain("ต้องตรวจหลักฐานธนาคารก่อนยืนยันธุรกรรม");
    expect(postApi).toContain('raw.settlement === "bank_transfer"');
  });
  it("queues print only AFTER confirmed atomic posting with stable retry id", () => {
    expect(cashier).toContain("await queueReceiptPrint(committedId, currentRequestId)");
    expect(cashier).toContain("printRequestId: currentRequestId");
    expect(cashier).toContain("queueReceiptPrint(posted.id, window.crypto.randomUUID())");
    expect(cashier).toContain('jobs.some(job => job.status === "failed")');
    expect(cashier).toContain("ตรวจเครื่องพิมพ์และคิวงานก่อนส่งพิมพ์ใหม่");
    expect(cashier).toContain("บันทึกธุรกรรมสำเร็จ แต่ส่งคำสั่งพิมพ์ไม่สำเร็จ");
    expect(printApi).toContain("queueRoutedRecyclingReceipt");
  });
  it("never hardcodes the acceptance shop as a tenant entitlement", () => {
    expect(cashier).not.toContain("155858");
    expect(toolbar).not.toContain("155858");
  });
});

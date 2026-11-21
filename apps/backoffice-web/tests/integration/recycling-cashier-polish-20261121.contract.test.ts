import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(file:string)=>readFileSync(resolve(process.cwd(),file),"utf8");
const cashier=src("src/components/pos/recycling-pos-workspace.tsx");
const toolbar=src("src/components/pos/recycling-sales-mode-switcher.tsx");
const sales=src("src/components/pos/recycling-sales-content.tsx");
const stock=src("src/app/preview/pos/recycling/stock/page.tsx");
const api=src("src/app/api/pos/recycling/transactions/route.ts");
const general=src("src/components/pos/pos-legacy-sales-content.tsx");

describe("CUSTOM Recycling cashier improvements without ordinary POS regression",()=>{
 it("decodes the physical EN barcode in scanner mode while keeping Thai-name search separate",()=>{
   expect(cashier).toContain('searchMode==="barcode"');
   expect(cashier).toContain('normalizeRecyclingBarcodeInput(event.target.value)');
   expect(cashier).toContain('physicalRecyclingBarcodeKey(event.code,event.shiftKey)');
   expect(cashier).toContain('scanBarcode(scanBufferRef.current || event.currentTarget.value)');
   expect(cashier).toContain('searchMode==="name"');
   expect(cashier).toContain('item.name,item.category,item.sku');
   expect(cashier).toContain('resolveRecyclingBarcode(barcodeIndex, normalized)');
   expect(cashier).toContain('if (product.priceBasis === "piece")');
   expect(cashier).toContain('openQuantityPopup(product)');
 });
 it("uses the same uploaded stock image assets in cashier",()=>{
   expect(stock).toContain('loadProductMediaMap({tenantId,branchId:branch.id})');
   expect(sales).toContain('loadProductMediaMap({tenantId,branchId})');
   expect(sales).toContain('mediaByProduct[item.id]=asset.thumbnail_url');
   expect(cashier).toContain('mediaUrl={mediaByProduct[item.id]}');
   expect(cashier).toContain('const imageUrl=mediaUrl || item.imageUrl');
 });
 it("paginates all matching product cards and filters with scrolling categories",()=>{
   expect(cashier).toContain('data-testid="recycling-category-tabs"');
   expect(cashier).toContain('overflow-x-auto');
   expect(cashier).toContain('data-testid="recycling-paged-catalog"');
   expect(cashier).toContain('grid-cols-[repeat(auto-fill,minmax(148px,1fr))]');
   expect(cashier).toContain('const pageSize=12;');
   expect(cashier).toContain('pageItems=filteredProducts.slice(');
   expect(cashier).toContain('data-testid="recycling-catalog-pagination"');
   expect(cashier).toContain('paginationPages.map(page=');
   expect(cashier).not.toContain('.slice(0, 30)');
 });
 it("accepts blank customer/supplier names and consistently posts a dash placeholder",()=>{
   expect(cashier).toContain('counterparty_name: counterpartyName.trim() || "-"');
   expect(cashier).toContain('ไม่บังคับ · เว้นว่างแสดง - บนบิล');
   expect(cashier).not.toContain('id="recycling-counterparty" autoFocus required');
   expect(api).toContain('const counterparty=enteredName || "-"');
   expect(api).toContain('p_counterparty_name: counterparty');
   expect(api).toContain('if (counterparty.length>240)');
   expect(api).toContain('raw.settlement === "bank_transfer"');
 });
 it("shows horizontal cash/bank transfer icons with only local arrow selection, not a new shortcut layer",()=>{
   expect(cashier).toContain('event.key==="ArrowLeft"||event.key==="ArrowRight"');
   expect(cashier).toContain('setSettlement(event.key==="ArrowLeft"?"cash":"bank_transfer")');
   expect(cashier).toContain('grid grid-cols-2 gap-2');
   expect(cashier).toContain('💵');
   expect(cashier).toContain('🏦');
   expect(cashier).toContain('settlement === "bank_transfer" || !visibleLines.length');
   expect(cashier).not.toContain('setSettlement("credit")');
 });
 it("isolates held bills from general POS, requires explicit cancel confirmation and preserves posted accounting",()=>{
   expect(cashier).toContain('recyclingHeldKey(tenantId,branchId,deviceCode,shiftId)');
   expect(cashier).toContain('parseRecyclingHeldBills(window.localStorage.getItem(storageKey),shiftId)');
   expect(cashier).toContain('data-testid="recycling-held-bills-modal"');
   expect(cashier).toContain('data-testid="recycling-cart-actions"');
   expect(cashier).toContain('role="alertdialog"');
   expect(cashier).toContain('window.confirm("มีรายการในตะกร้าอยู่แล้ว');
   expect(cashier).toContain('saveHeldBills(heldBills.filter(item=>item.id!==bill.id))');
   expect(cashier).toContain('currentPrice!==saved.unitPrice');
   expect(cashier).toContain('requestIdRef.current=""');
   expect(toolbar).toContain('data-testid="recycling-held-bills-toolbar"');
   expect(toolbar).toContain('onOpenHeldBills');
   expect(general).not.toContain('recyclingHeldKey');
   expect(api).not.toContain('held-bill');
 });
});

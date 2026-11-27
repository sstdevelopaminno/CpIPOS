import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Grocery checkout fast barcode + SKU phase 1 and 2", () => {
  const scanner = read("src/components/pos/pos-general-sale-table-controller.tsx");
  const catalog = read("src/components/pos/pos-product-catalog.tsx");
  const sales = read("src/components/pos/pos-sales-module.tsx");
  const pay = read("src/components/pos-ui/pos-payment-panel.tsx");
  const runtime = read("src/components/pos/pos-general-sale-runtime.tsx");
  const api = read("src/app/api/backoffice/catalog/route.ts");
  const create = read("src/components/pos-preview/add-product-popup-button.tsx");
  const edit = read("src/components/pos-preview/edit-product-popup-button.tsx");
  const table = read("src/components/pos-preview/stock-products-table.tsx");
  const barcode = read("src/components/pos-preview/stock-sku-reveal.tsx");

  it("mounts quantity before scan and resets only on confirmed cart success", () => {
    expect(scanner).toContain('qtyInput.dataset.posGroceryScanQuantity = "1"');
    expect(scanner).toContain('qtyInput.value = "1"');
    expect(scanner).toContain("form.appendChild(quantityLabel)");
    expect(scanner).toContain("form.append(input, submit)");
    expect(scanner).toContain("validatedGroceryScanQuantity");
    expect(scanner).toContain("bridgeStatus !== \"added\"");
    expect(scanner).toContain('amountInput.value = "1"');
    expect(scanner).toContain("shouldResetRetailScanQuantity(acceptedQuantityRevision, quantityRevision)");
    expect(scanner).toContain('if (!opticalActive) {');
    expect(scanner).toContain("scanQueue.push({");
    expect(scanner).toContain("nextCode.quantity");
  });

  it("normalizes physical scanner keys in field without global language changes", () => {
    expect(scanner).toContain('input.lang = "en"');
    expect(scanner).toContain("asciiKeyFromScannerCode(event.code, event.key, event.shiftKey)");
    expect(scanner).toContain('input.setRangeText(mapped, cursor, end, "end")');
    expect(scanner).toContain("OPTICAL_SCAN_IDLE_MS");
    expect(scanner).toContain("groceryFastKeyCount < 5");
    expect(scanner).toContain("signal: controller.signal");
    expect(scanner).toContain("encodeURIComponent(originalSku)");
    expect(scanner).not.toContain("navigator.keyboard.lock(");
  });

  it("sends one quantity addition to the live stock-capped React cart", () => {
    expect(scanner).toContain("addLookupProductToReactCart(product, quantity)");
    expect(catalog).toContain("onAddProduct(product, quantity)");
    expect(sales).toContain("addCartLine(product, { quantity })");
    expect(sales).toContain("cartQty + quantity > Number(stockUnits)");
    expect(sales).toContain('startupRetailKind === "general_sale" && quickMode === "home"');
  });

  it("replaces front-cash keypad with native five actions, preserving checkout", () => {
    expect(runtime).not.toContain("PosGeneralSaleFrontCashPanel");
    expect(pay).toContain('data-testid="pos-grocery-bill-actions"');
    for (const handler of ["onHoldBill", "onOpenHeldBills", "onMember", "onPromotion", "handleOpenCashDrawerClick"]) {
      expect(pay).toContain(handler);
    }
    expect(pay).toContain("onClick={onCheckout}");
    expect(sales).toContain('const groceryRetail = !opticalRetailActive && startupRetailKind === "general_sale" && quickMode === "home"');
    expect(sales).toContain("groceryRetail={groceryRetail}");
  });

  it("creates or edits user-defined SKU while preserving existing branch identity and unique index", () => {
    expect(create).toContain('name="create-product-sku-mode"');
    expect(create).toContain('sku_mode: skuMode');
    expect(create).toContain('sku: skuMode === "auto"');
    expect(edit).toContain("...(skuChanged ? { sku: normalizedSku } : {})");
    expect(api).toContain("selectedProductSku({ mode: skuMode");
    expect(api).toContain(".eq(\"tenant_id\", input.tenantId)");
    expect(api).toContain(".eq(\"branch_id\", input.branchId)");
    expect(api).toContain('fail("duplicate_product_sku"');
    expect(api).toContain('updatePayloadCandidatesWithCustomerSelection');
  });

  it("opens a print/copy Code128 popup using the exact displayed SKU", () => {
    expect(table).toContain("<StockSkuReveal sku={item.sku} th={th} name={item.name} />");
    expect(table).toContain("sku: item.sku");
    expect(barcode).toContain("opticalCode128Svg(code)");
    expect(barcode).toContain('role="dialog"');
    expect(barcode).toContain("window.open(");
    expect(barcode).toContain("window.print()");
    expect(barcode).toContain("navigator.clipboard.writeText(code)");
    expect(barcode).not.toContain("replace(/\\D+/g");
  });
});

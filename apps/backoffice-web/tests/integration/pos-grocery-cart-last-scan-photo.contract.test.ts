import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Grocery POS: separate SKU/category columns and show latest scanned photo", () => {
  const controller = read("src/components/pos/pos-general-sale-table-controller.tsx");
  const events = read("src/lib/pos-general-sale-mode.ts");
  const sales = read("src/components/pos/pos-sales-module.tsx");
  const preview = read("src/components/pos/pos-grocery-last-scanned-preview.tsx");

  it("allocates a wide fixed SKU column, wraps legacy long codes and scrolls horizontally", () => {
    expect(controller).toContain("min-width: 1150px");
    expect(controller).toContain(".cpipos-sd-table__sku { width: 230px");
    expect(controller).toContain("overflow-wrap: anywhere; word-break: break-word; white-space: normal");
    expect(controller).toContain(".cpipos-sd-table__category { width: 145px");
    expect(controller).toContain("const columnClasses = opticalActive");
    expect(controller).toContain(": fullClasses;");
    expect(controller).toContain("colgroup.appendChild(col)");
    expect(controller).toContain("skuCell.textContent = row.sku");
    expect(controller).toContain("skuCell.title = row.sku");
    expect(controller).toContain(".cpipos-sd-table__scroll { width: 100%; overflow: auto;");
    expect(controller).toContain('html[${OPTICAL_ACTIVE_ROOT_ATTRIBUTE}="1"] .cpipos-sd-table table {');
  });

  it("emits photo updates only after actual accepted scanner additions (not failed scans)", () => {
    expect(events).toContain('GENERAL_SALE_LAST_SCANNED_EVENT = "cpipos:general-sale-last-scanned"');
    const accepted = controller.indexOf('if (bridgeStatus !== "added")');
    const emit = controller.indexOf("GENERAL_SALE_LAST_SCANNED_EVENT,", accepted);
    expect(accepted).toBeGreaterThan(0);
    expect(emit).toBeGreaterThan(accepted);
    expect(controller.slice(accepted, emit)).toContain("status.dataset.tone = \"success\"");
    expect(controller.slice(accepted, emit)).toContain("if (!opticalActive)");
  });

  it("uses only the grocery sidebar blank area; all other cart modes retain their original items", () => {
    expect(sales).toContain('const groceryRetail = !opticalRetailActive && startupRetailKind === "general_sale" && quickMode === "home"');
    expect(sales).toContain("<PosGroceryLastScannedPreview product={cart.length > 0 ? lastGroceryScannedProduct : null} language={lang} />");
    expect(sales).toContain(") : renderCartList()}");
    expect(sales).toContain("groceryRetail={groceryRetail}");
    expect(sales).toContain("previouslyHadCartItemsRef.current && cart.length === 0");
    expect(sales).toContain('window.addEventListener(GENERAL_SALE_LAST_SCANNED_EVENT, onSuccessfulGroceryScan)');
  });

  it("fetches the product photo from the current authenticated media API without delaying checkout", () => {
    expect(preview).toContain("/api/pos/product-media?product_ids=");
    expect(preview).toContain('credentials: "include"');
    expect(preview).toContain("resolveProductMediaCardUrls");
    expect(preview).toContain("controller.abort()");
    expect(preview).toContain("releaseMedia()");
    expect(preview).toContain("if (disposed)");
    expect(preview).toContain("resolved?.productId === productId");
    expect(preview).toContain("onError={() => setImageFailed(true)}");
  });

  it("shows CpiPOS logo on missing photo, failed image, empty cart and never changes receipts/stock", () => {
    expect(preview).toContain('src="/brand/cpipos-logo.png"');
    expect(preview).toContain("useProductPhoto ? (");
    expect(preview).toContain("aria-live=\"polite\"");
    expect(preview).toContain("สินค้าที่สแกนล่าสุด");
    expect(controller).not.toContain("setStockOnHand(");
    expect(preview).not.toContain('method: "POST"');
  });
});

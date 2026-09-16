import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(...segments: string[]) {
  return readFileSync(resolve(process.cwd(), ...segments), "utf8");
}

describe("POS SD general sale source contract", () => {
  it("exposes canonical product SKU to the SD scanner", () => {
    const card = readRepoFile("src", "components", "pos-ui", "pos-product-card.tsx");
    const catalog = readRepoFile("src", "components", "pos", "pos-product-catalog.tsx");

    expect(card).toContain("data-pos-product-sku={normalizedSku || undefined}");
    expect(catalog).toContain("productSku={product.sku}");
  });

  it("resolves scans from the branch product catalog instead of visible product cards", () => {
    const controller = readRepoFile("src", "components", "pos", "pos-general-sale-table-controller.tsx");
    const lookupRoute = readRepoFile("src", "app", "api", "pos", "products", "lookup", "route.ts");
    const catalog = readRepoFile("src", "components", "pos", "pos-product-catalog.tsx");

    expect(controller).toContain("/api/pos/products/lookup?sku=");
    expect(controller).toContain("GENERAL_SALE_ADD_PRODUCT_EVENT");
    expect(controller).not.toContain("findProductCardBySku");
    expect(controller).not.toContain("data-pos-product-sku=\"");
    expect(controller).not.toContain("card.click()");

    expect(lookupRoute).toContain("requirePosSession()");
    expect(lookupRoute).toContain('requirePermission(scope, "sales:enter")');
    expect(lookupRoute).toContain('"barcode_scanner_mode"');
    expect(lookupRoute).toContain('.eq("tenant_id", tenantId)');
    expect(lookupRoute).toContain('.eq("branch_id", branchId)');
    expect(lookupRoute).toContain('fail("ambiguous_product_sku"');
    expect(lookupRoute).not.toContain("export async function POST");

    expect(catalog).toContain("GENERAL_SALE_ADD_PRODUCT_EVENT");
    expect(catalog).toContain("onAddProduct(product);");
    expect(catalog).toContain('status: "added"');
  });

  it("keeps the scanner table read-only toward stored cart data and delegates cart actions to React controls", () => {
    const controller = readRepoFile("src", "components", "pos", "pos-general-sale-table-controller.tsx");
    const tableModel = readRepoFile("src", "lib", "pos-general-sale-cart-table.ts");

    expect(controller).toContain('POS_TAKEAWAY_CART_STORAGE_KEY = "pos_sales_cart_v012"');
    expect(controller).toContain('POS_SALES_SNAPSHOT_STORAGE_KEY = "pos_sales_snapshot_v001"');
    expect(controller).toContain("window.localStorage.getItem(POS_TAKEAWAY_CART_STORAGE_KEY)");
    expect(controller).toContain("window.localStorage.getItem(POS_SALES_SNAPSHOT_STORAGE_KEY)");
    expect(controller).not.toContain("localStorage.setItem(POS_TAKEAWAY_CART_STORAGE_KEY");
    expect(controller).not.toContain("localStorage.setItem(POS_SALES_SNAPSHOT_STORAGE_KEY");
    expect(controller).toContain("target?.click();");
    expect(controller).toContain(".posui-cart-action--delete");
    expect(tableModel).toContain("buildGeneralSaleCartTableRows");
    expect(tableModel).toContain("lineTotal");
  });

  it("keeps grocery/general-sale on scanner-table layout without creating another checkout engine", () => {
    const controller = readRepoFile("src", "components", "pos", "pos-general-sale-table-controller.tsx");

    expect(controller).toContain('window.localStorage.setItem(GENERAL_SALE_LAYOUT_STORAGE_KEY, "table")');
    expect(controller).toContain('document.documentElement.setAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE, "table")');
    expect(controller).toContain("GENERAL_SALE_CHECKOUT_BASE_MODE");
    expect(controller).toContain("homeButton.click();");
    expect(controller).not.toContain('data.sdLayout = "grid"');
    expect(controller).not.toContain('"สินค้า + ตะกร้า"');
    expect(controller).not.toContain('fetch("/api/pos/sales"');
    expect(controller).not.toContain("order_type");
    expect(controller).not.toContain("printer-routing");
    expect(controller).not.toContain("kitchen/print");
  });

  it("gates SD with the existing package and branch feature-control plane", () => {
    const controller = readRepoFile("src", "components", "pos", "pos-general-sale-table-controller.tsx");
    const featureMap = readRepoFile("src", "lib", "pos-feature-map.ts");
    const featuresRoute = readRepoFile("src", "app", "api", "pos", "features", "route.ts");

    expect(featureMap).toContain('general_sale: "barcode_scanner_mode"');
    expect(controller).toContain('fetch("/api/pos/features"');
    expect(controller).toContain("POS_MODE_FEATURES.general_sale");
    expect(featuresRoute).toContain("hasBranchFeatureSafe");
    expect(controller).not.toContain("350");
    expect(controller).not.toContain("550");
  });

  it("mounts the optimized SD General Sale controller on both primary POS entry routes", () => {
    const previewPage = readRepoFile("src", "app", "preview", "pos", "page.tsx");
    const salesPage = readRepoFile("src", "app", "(backoffice)", "pos", "sales", "page.tsx");

    expect(previewPage).toContain("<PosGeneralSaleTableController />");
    expect(salesPage).toContain("<PosGeneralSaleTableController />");
    expect(previewPage).not.toContain("<PosGeneralSaleModeController />");
    expect(salesPage).not.toContain("<PosGeneralSaleModeController />");
  });
});

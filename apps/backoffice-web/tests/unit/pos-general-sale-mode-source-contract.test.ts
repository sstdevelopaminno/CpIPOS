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

  it("reuses the Home/Takeaway engine instead of creating a second transaction engine", () => {
    const controller = readRepoFile("src", "components", "pos", "pos-general-sale-mode-controller.tsx");

    expect(controller).toContain("GENERAL_SALE_CHECKOUT_BASE_MODE");
    expect(controller).toContain("homeButton.click();");
    expect(controller).not.toContain('fetch("/api/pos/sales"');
    expect(controller).not.toContain("order_type");
    expect(controller).not.toContain("printer-routing");
    expect(controller).not.toContain("kitchen/print");
  });

  it("gates SD with the existing package and branch feature-control plane", () => {
    const controller = readRepoFile("src", "components", "pos", "pos-general-sale-mode-controller.tsx");
    const featureMap = readRepoFile("src", "lib", "pos-feature-map.ts");
    const featuresRoute = readRepoFile("src", "app", "api", "pos", "features", "route.ts");

    expect(featureMap).toContain('general_sale: "barcode_scanner_mode"');
    expect(controller).toContain('fetch("/api/pos/features"');
    expect(controller).toContain("POS_MODE_FEATURES.general_sale");
    expect(featuresRoute).toContain("hasBranchFeatureSafe");
    expect(controller).not.toContain("350");
    expect(controller).not.toContain("550");
  });

  it("mounts SD General Sale on both primary POS entry routes", () => {
    const previewPage = readRepoFile("src", "app", "preview", "pos", "page.tsx");
    const salesPage = readRepoFile("src", "app", "(backoffice)", "pos", "sales", "page.tsx");

    expect(previewPage).toContain("<PosGeneralSaleModeController />");
    expect(salesPage).toContain("<PosGeneralSaleModeController />");
  });
});

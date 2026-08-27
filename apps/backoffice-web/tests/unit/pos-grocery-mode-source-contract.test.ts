import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(...segments: string[]) {
  return readFileSync(resolve(process.cwd(), ...segments), "utf8");
}

describe("POS grocery mode source contract", () => {
  it("exposes canonical product SKU to the grocery scanner", () => {
    const card = readRepoFile("src", "components", "pos-ui", "pos-product-card.tsx");
    const catalog = readRepoFile("src", "components", "pos", "pos-product-catalog.tsx");

    expect(card).toContain("data-pos-product-sku={normalizedSku || undefined}");
    expect(catalog).toContain("productSku={product.sku}");
  });

  it("reuses the Home/Takeaway engine instead of creating a second transaction engine", () => {
    const controller = readRepoFile("src", "components", "pos", "pos-grocery-mode-controller.tsx");

    expect(controller).toContain('const homeButton = grid.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="home"]`)');
    expect(controller).toContain("homeButton.click();");
    expect(controller).not.toContain('fetch("/api/pos/sales"');
    expect(controller).not.toContain("order_type");
    expect(controller).not.toContain("printer-routing");
    expect(controller).not.toContain("kitchen/print");
  });

  it("mounts Grocery on both primary POS entry routes", () => {
    const previewPage = readRepoFile("src", "app", "preview", "pos", "page.tsx");
    const salesPage = readRepoFile("src", "app", "(backoffice)", "pos", "sales", "page.tsx");

    expect(previewPage).toContain("<PosGroceryModeController />");
    expect(salesPage).toContain("<PosGroceryModeController />");
  });
});

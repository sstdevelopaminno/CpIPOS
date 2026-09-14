import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const controllerPath = path.resolve(
  process.cwd(),
  "src/components/pos-preview/stock-bundle-inline-controller.tsx",
);
const layoutPath = path.resolve(process.cwd(), "src/app/layout.tsx");

describe("stock bundle popup body portal", () => {
  it("renders bundle controls outside the product popup DOM and anchors them beside the ingredient toggle", () => {
    const controller = fs.readFileSync(controllerPath, "utf8");
    const layout = fs.readFileSync(layoutPath, "utf8");

    expect(controller).toContain("createPortal(");
    expect(controller).toContain("document.body");
    expect(controller).toContain("calculateAnchor");
    expect(controller).toContain("findIngredientToggleLabel");
    expect(controller).toContain('data-cpipos-bundle-anchor="true"');
    expect(layout).toContain("<StockBundleInlineController />");
    expect(layout).not.toContain("<StockBundlePopupHostKeeper />");
  });
});

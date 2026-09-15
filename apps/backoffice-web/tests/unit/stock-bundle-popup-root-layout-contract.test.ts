import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const layoutPath = path.resolve(process.cwd(), "src/app/layout.tsx");

describe("stock bundle popup root mount", () => {
  it("keeps the inline bundle controller mounted for client-side POS navigation", () => {
    const source = fs.readFileSync(layoutPath, "utf8");
    expect(source).toContain(
      'import { StockBundleInlineController } from "@/components/pos-preview/stock-bundle-inline-controller"',
    );
    expect(source).toContain("<StockBundleInlineController />");
    expect(source).not.toContain("<StockBundlePopupEnhancer />");
  });
});

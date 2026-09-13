import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("bundle popup production regression summary", () => {
  it("keeps the production popup enhancer active and discoverable", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/components/pos-preview/stock-bundle-popup-enhancer.tsx"), "utf8");
    expect(source).toContain("findStockProductModal()");
    expect(source).toContain("MutationObserver");
    expect(source).toContain('data-cpipos-bundle-popup="true"');
  });
});

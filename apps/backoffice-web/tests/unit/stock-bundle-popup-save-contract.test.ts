import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const enhancerPath = path.resolve(process.cwd(), "src/components/pos-preview/stock-bundle-popup-enhancer.tsx");

describe("stock bundle popup save contract", () => {
  it("writes bundle composition through the canonical popup API", () => {
    const source = fs.readFileSync(enhancerPath, "utf8");

    expect(source).toContain('fetch("/api/backoffice/bundles/popup"');
    expect(source).toContain('action: "upsert_bundle"');
    expect(source).toContain("product_id: item.id");
    expect(source).toContain("qty: Number(selection[item.id]?.qty ?? 0)");
    expect(source).toContain("items.length < 2");
  });
});

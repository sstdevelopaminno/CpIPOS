import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const keeperPath = path.resolve(process.cwd(), "src/components/pos-preview/stock-bundle-popup-host-keeper.tsx");
const layoutPath = path.resolve(process.cwd(), "src/app/layout.tsx");

describe("stock bundle popup host keeper", () => {
  it("re-attaches the exact bundle portal host after popup DOM replacement", () => {
    const keeper = fs.readFileSync(keeperPath, "utf8");
    const layout = fs.readFileSync(layoutPath, "utf8");

    expect(keeper).toContain('cpipos-stock-bundle-popup-controls');
    expect(keeper).toContain("MutationObserver");
    expect(keeper).toContain("attachHost(modal, rememberedHost)");
    expect(layout).toContain("<StockBundlePopupHostKeeper />");
  });
});

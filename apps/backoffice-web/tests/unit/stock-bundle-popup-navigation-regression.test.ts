import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(process.cwd(), "src/components/pos-preview/stock-bundle-popup-enhancer.tsx");

describe("stock bundle client navigation regression", () => {
  it("does not permanently disable the enhancer based on its first pathname", () => {
    const source = fs.readFileSync(sourcePath, "utf8");
    const effectStart = source.indexOf("useEffect(() => {");
    const observerStart = source.indexOf("const observer = new MutationObserver(sync);");
    const firstEffect = source.slice(effectStart, observerStart);

    expect(firstEffect).not.toContain("window.location.pathname");
    expect(firstEffect).toContain("findStockProductModal()");
  });
});

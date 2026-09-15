import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(process.cwd(), "src/components/pos-preview/stock-bundle-popup-enhancer.tsx");

describe("stock bundle popup UI contract", () => {
  it("renders the requested bundle selector and per-component quantity controls", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("ชุดรวมขาย");
    expect(source).toContain("สินค้าในชุด");
    expect(source).toContain("จำนวนต่อ 1 ชุด");
    expect(source).toContain("checked={line.selected}");
    expect(source).toContain("disabled={!line.selected}");
  });
});

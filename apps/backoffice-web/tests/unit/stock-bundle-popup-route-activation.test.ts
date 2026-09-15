import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(
  process.cwd(),
  "src/components/pos-preview/stock-bundle-inline-controller.tsx",
);

describe("stock bundle popup route activation", () => {
  it("keeps observing the app root and activates the inline controller on the stock route", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain('if (typeof window === "undefined") return;');
    expect(source).toContain('window.location.pathname.startsWith("/preview/pos/stock")');
    expect(source).toContain("const observer = new MutationObserver(sync);");
    expect(source).toContain('text.includes("จัดการสินค้าและสต๊อก")');
    expect(source).toContain("<span>สินค้าชุดรวมขาย</span>");
    expect(source).toContain("จำนวนต่อ 1 ชุด");
    expect(source).toContain("findIngredientToggleLabel");
  });
});

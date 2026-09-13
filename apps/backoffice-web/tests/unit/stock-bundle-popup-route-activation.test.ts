import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(process.cwd(), "src/components/pos-preview/stock-bundle-popup-enhancer.tsx");

describe("stock bundle popup route activation", () => {
  it("keeps observing the app root even when the enhancer mounts before navigating to stock", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain('if (typeof window === "undefined") return;');
    expect(source).not.toContain('typeof window === "undefined" || !window.location.pathname.includes("/preview/pos/stock")');
    expect(source).toContain("const observer = new MutationObserver(sync);");
    expect(source).toContain('text.includes("จัดการสินค้าและสต๊อก")');
    expect(source).toContain('<span>ชุดรวมขาย</span>');
    expect(source).toContain('จำนวนต่อ 1 ชุด');
  });
});

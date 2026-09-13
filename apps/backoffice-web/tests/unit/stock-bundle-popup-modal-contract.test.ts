import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const enhancerPath = path.resolve(process.cwd(), "src/components/pos-preview/stock-bundle-popup-enhancer.tsx");
const addPopupPath = path.resolve(process.cwd(), "src/components/pos-preview/add-product-popup-button.tsx");

describe("stock bundle popup modal contract", () => {
  it("matches the production Thai stock popup and its save controls", () => {
    const enhancer = fs.readFileSync(enhancerPath, "utf8");
    const addPopup = fs.readFileSync(addPopupPath, "utf8");

    expect(addPopup).toContain("จัดการสินค้าและสต๊อก");
    expect(addPopup).toContain("บันทึกสินค้า");
    expect(addPopup).toContain("2. ชื่อสินค้า");
    expect(enhancer).toContain("จัดการสินค้าและสต๊อก");
    expect(enhancer).toContain("บันทึกสินค้า");
    expect(enhancer).toContain("ชื่อสินค้า");
  });
});

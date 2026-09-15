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

  it("does not hide the entire bundle UI when label span markup changes", () => {
    const enhancer = fs.readFileSync(enhancerPath, "utf8");

    expect(enhancer).toContain("const labelText = textOf(label)");
    expect(enhancer).not.toContain('label.querySelector("span")');
    expect(enhancer).not.toContain("if (!productNameControl) return null");
    expect(enhancer).toContain("สินค้าชุดรวมขาย");
    expect(enhancer).toContain("จำนวนต่อ 1 ชุด");
    expect(enhancer).toContain("ค้นหาชื่อสินค้า / SKU / หมวดหมู่");
  });

  it("uses the bundle API entitlement to hide the UI when the feature is disabled", () => {
    const enhancer = fs.readFileSync(enhancerPath, "utf8");

    expect(enhancer).toContain("feature_not_enabled");
    expect(enhancer).toContain("setFeatureAvailable(false)");
    expect(enhancer).toContain("featureAvailable !== true");
  });
});

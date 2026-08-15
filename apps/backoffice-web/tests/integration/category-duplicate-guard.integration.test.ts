import { describe, expect, it } from "vitest";
import { findSimilarCategoryName } from "@/lib/pos/category-duplicate-guard";

describe("category duplicate guard", () => {
  it("warns on a one-character Thai typo", () => {
    expect(findSimilarCategoryName("จี้มจุ่ม", ["จิ้มจุ่ม", "เครื่องดื่ม"]))?.name).toBe("จิ้มจุ่ม");
  });

  it("warns when only punctuation differs", () => {
    expect(findSimilarCategoryName("ต้มแซ่บ$ทอด", ["ต้มแซ่บ&ทอด"]))?.reason).toBe("punctuation");
    expect(findSimilarCategoryName("ตำเกาเหลา&ตำเส้นสด", ["ตำเกาเหลา/ตำเส้นสด"]))?.reason).toBe("punctuation");
  });

  it("does not warn for clearly different intended categories", () => {
    expect(findSimilarCategoryName("เครื่องดื่มทั่วไป", ["เครื่องดื่ม", "ทานเล่น", "เมนูทานเล่น"])).toBeNull();
    expect(findSimilarCategoryName("เมนูทานเล่น", ["ทานเล่น", "เครื่องดื่ม"])).toBeNull();
  });

  it("leaves exact duplicate handling to the existing exact-name guard", () => {
    expect(findSimilarCategoryName(" จิ้มจุ่ม ", ["จิ้มจุ่ม"])).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const salesRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/pos/sales/route.ts"),
  "utf8"
);

describe("POS sales product SKU contract", () => {
  it("uses sku as the canonical product identifier without probing products.code", () => {
    expect(salesRoute).toContain(
      'selectClause: "id,sku,name,category,price,is_active,stock_deduction_mode"'
    );
    expect(salesRoute).not.toMatch(/selectClause:\s*"[^"]*\bcode\b/);
    expect(salesRoute).not.toContain("row.code");
    expect(salesRoute).not.toContain("preferredCode");
    expect(salesRoute).not.toContain("isMissingProductCodeColumnError");
  });

  it("keeps conservative projection fallbacks for optional product fields", () => {
    expect(salesRoute).toContain("isMissingProductSkuColumnError");
    expect(salesRoute).toContain("isMissingProductStockDeductionModeColumnError");
    expect(salesRoute).toContain("isMissingProductCategoryColumnError");
    expect(salesRoute).toContain("isMissingProductIsActiveColumnError");
    expect(salesRoute).toContain('const sku = String(row.sku ?? "").trim();');
  });
});

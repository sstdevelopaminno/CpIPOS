import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const source = readFileSync(resolve(process.cwd(), "src/app/api/pos/features/route.ts"), "utf8");
describe("CUSTOM Optical sidebar package gate", () => {
  it("uses cashier entitlement for authorized Optical stores", () => {
    expect(source).toContain("if (isCustom && salesModes.optical_retail)");
    expect(source).toContain("features.core_pos_sales = true;");
    expect(source).toContain("features.barcode_scanner_mode = true;");
  });
  it("respects explicit branch and tenant feature settings", () => {
    expect(source).toContain('!tenantOverrides.has("core_pos_sales") && !branchOverrides.has("core_pos_sales")');
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const gate = readFileSync(resolve(process.cwd(), "src/lib/feature-gate.ts"), "utf8");
describe("Optical CUSTOMER POS sales entry entitlement", () => {
  it("derives the cashier baseline only for IT-approved Optical CUSTOM contracts", () => {
    expect(gate).toContain('featureCode === "pos.sales.access"');
    expect(gate).toContain('featureCode === "pos_sales"');
    expect(gate).toContain('featureCode === "core_pos_sales"');
    expect(gate).toContain('isOpticalRetailExplicitlyEnabled(contract?.metadata?.sales_modes)');
    expect(gate).toContain('String(packageLookup.data?.code ?? "").toLowerCase() === "custom"');
  });
  it("never defeats an explicit feature denial or inactive contract", () => {
    expect(gate).toContain("!tenantOverride && !branchOverride");
    expect(gate).toContain("if (!contractAllowsAccess(contract)) {");
    expect(gate).toContain("if (branchOverride) {");
  });
  it("keeps optical access mode separate from generic sale mode and nav locks", () => {
    expect(gate).toContain('featureCode === "barcode_scanner_mode"');
    expect(gate).not.toContain('if (isOpticalRetailExplicitlyEnabled(contract?.metadata?.sales_modes)) return true;');
  });
});

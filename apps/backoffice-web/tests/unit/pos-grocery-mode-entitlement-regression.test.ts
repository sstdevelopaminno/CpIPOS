import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeCustomPosSalesModes,
  resolvePosSalesModePolicy
} from "../../src/lib/pos-sales-modes";

const growth = { sales_mode_limit: 2, default_sales_modes: ["general_sale", "takeaway"] };
const business = { sales_mode_limit: 3, default_sales_modes: ["general_sale", "takeaway", "dine_in"] };
const starter = { sales_mode_limit: 1, default_sales_modes: ["general_sale"] };

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT -> CpIPOS grocery / general-sale mode regressions", () => {
  it("Growth: honors the two IT-approved modes and does not require a third", () => {
    const modes = resolvePosSalesModePolicy({
      sales_modes: { takeaway: true, general_sale: true, dine_in: false }
    }, growth);
    expect(modes.takeaway).toBe(true);
    expect(modes.general_sale).toBe(true);
    expect(modes.dine_in).toBe(false);
    expect(Object.values(modes).filter(Boolean)).toHaveLength(2);
  });

  it("Growth: honors newly selected grocery instead of forcing package-default modes", () => {
    const modes = resolvePosSalesModePolicy({
      sales_modes: { takeaway: false, dine_in: true, general_sale: true }
    }, growth);
    expect(modes.general_sale).toBe(true);
    expect(modes.dine_in).toBe(true);
    expect(modes.takeaway).toBe(false);
  });

  it("Business: exposes exactly three IT-approved modes when upgrading from Growth", () => {
    const modes = resolvePosSalesModePolicy({
      sales_modes: { takeaway: true, dine_in: true, general_sale: true,
        buffet_table: false, delivery: false, optical_retail: false }
    }, business);
    expect(Object.values(modes).filter(Boolean)).toHaveLength(3);
    expect(modes.general_sale).toBe(true);
    expect(modes.takeaway).toBe(true);
    expect(modes.dine_in).toBe(true);
  });

  it("Starter: only its one package mode is on if IT never submitted a selection", () => {
    const modes = resolvePosSalesModePolicy({}, starter);
    expect(Object.entries(modes).filter(([, enabled]) => enabled).map(([key]) => key))
      .toEqual(["general_sale"]);
  });

  it("never enables omitted flags or optical mode from a partial selection", () => {
    const modes = resolvePosSalesModePolicy({ sales_modes: { general_sale: true } }, growth);
    expect(Object.entries(modes).filter(([, enabled]) => enabled).map(([key]) => key))
      .toEqual(["general_sale"]);
    expect(normalizeCustomPosSalesModes({ general_sale: true }).optical_retail).toBe(false);
  });

  it("legacy over-limit selections fail closed to the tier quota without injecting modes", () => {
    const modes = resolvePosSalesModePolicy({
      sales_modes: { takeaway: true, dine_in: true, general_sale: true }
    }, growth);
    expect(Object.values(modes).filter(Boolean)).toHaveLength(2);
    expect(Object.keys(modes).filter((key) => modes[key as keyof typeof modes]))
      .toEqual(["takeaway", "dine_in"]);
    // IT API now rejects creating new over-limit snapshots rather than dropping a user's mode.
  });

  it("authorizes scanner checkout from the approved mode in BOTH feature read paths", () => {
    const endpoint = source("src/app/api/pos/features/route.ts");
    const serverGate = source("src/lib/feature-gate.ts");
    const scanner = source("src/app/api/pos/products/lookup/route.ts");
    expect(endpoint).toContain("resolvePosSalesModePolicy(metadata, packagePolicyResult.data?.metadata)");
    expect(endpoint).toContain("if (salesModes.general_sale)");
    expect(endpoint).toContain("features.barcode_scanner_mode = true");
    expect(serverGate).toContain('featureCode === "barcode_scanner_mode"');
    expect(serverGate).toContain("resolvePosSalesModePolicy(contract.metadata ?? {}, packageLookup.data?.metadata)");
    expect(serverGate).toContain("!tenantOverride && !branchOverride");
    expect(scanner).toContain('requireTenantFeature(scope.session.tenant_id, "barcode_scanner_mode"');
    expect(scanner).toContain('requireTenantFeature(scope.session.tenant_id, "core_pos_sales"');
  });

  it("POS startup and mode button consume verified features instead of falling back to home", () => {
    const initial = source("src/components/pos/pos-initial-sales-mode-controller.tsx");
    const grocery = source("src/components/pos/pos-general-sale-table-controller.tsx");
    expect(initial).toContain("getAuthorizedCustomPosStartupMode(order ?? [], productProfile, authorizedGrants)");
    expect(initial).toContain("if (!authorizedMode) return fail");
    expect(initial).toContain("features[POS_MODE_FEATURES.general_sale] === true");
    expect(grocery).toContain('fetch("/api/pos/features?refresh=1"');
    expect(grocery).toContain("body?.data?.features?.core_pos_sales === true");
    expect(grocery).toContain("body?.data?.sales_modes?.general_sale === true");
  });
});

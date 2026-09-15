import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FG0004_DRY_RUN_PROVISIONING_MANIFEST,
  FG0004_PROVISIONING_POSTFLIGHT_CHECKS,
  FG0004_PROVISIONING_PREFLIGHT_CHECKS,
  FG0004_PROVISIONING_REQUIRED_INPUTS,
  RESTAURANT_QR_BRANCH_CODE_PATTERN,
  RESTAURANT_QR_STANDARD_FEATURE_MANIFEST,
  buildRestaurantQrBranchCode
} from "../../src/lib/restaurant-qr-provisioning";
import { RESTAURANT_QR_PRODUCT_PROFILE } from "../../src/lib/restaurant-qr-profile";

const restaurantQrProfile = readFileSync(new URL("../../src/lib/restaurant-qr-profile.ts", import.meta.url), "utf8");
const fg0004ProvisioningSource = readFileSync(new URL("../../src/lib/restaurant-qr-provisioning.ts", import.meta.url), "utf8");
const restaurantQrStandardDoc = readFileSync(new URL("../../../../docs/RESTAURANT_QR_STANDARD.md", import.meta.url), "utf8");

describe("FG0004 Restaurant QR provisioning prep contract", () => {
  it("keeps FG0004 as a dry-run manifest with no live writes or FG0003 mutations", () => {
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST).toMatchObject({
      store_code: "FG0004",
      product_profile: RESTAURANT_QR_PRODUCT_PROFILE,
      package: "TBD",
      deployment_mode: "CENTRAL",
      update_ring: "PILOT",
      status: "PROVISIONING",
      safety: {
        db_writes: false,
        fg0003_modifications: false,
        other_store_modifications: false,
        copy_fg0003_data: false
      }
    });
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST.branches[0]?.branch_code).toBe(RESTAURANT_QR_BRANCH_CODE_PATTERN);
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST.branches[0]?.branch_name).toBe("TBD");
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST.table_configuration.table_count).toBe("TBD");
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST.table_configuration.qr_generation_mode).toBe("SECURE_PER_TABLE");
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST.restaurant_qr_enablement).toEqual({
      product_profile: RESTAURANT_QR_PRODUCT_PROFILE,
      registry_table: "app.restaurant_qr_store_registry",
      store_specific_business_branch: false
    });
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST.eventual_live_provisioning).toEqual({
      transactional: true,
      idempotent: true,
      stop_if_store_code_exists: true,
      execute_now: false
    });
  });

  it("defines the required provisioning inputs and standard feature manifest", () => {
    expect(FG0004_PROVISIONING_REQUIRED_INPUTS).toEqual([
      "Store display name",
      "Branch display name",
      "Province/city/location code",
      "Package",
      "Table count",
      "Table naming style",
      "POS device count",
      "POS hardware models",
      "Customer display YES/NO",
      "Receipt printer count/type",
      "Kitchen printer count/type",
      "Primary owner/manager user",
      "Employee login requirement",
      "Payment methods",
      "Opening date/time"
    ]);
    expect(RESTAURANT_QR_STANDARD_FEATURE_MANIFEST).toContain("qr_review_popup");
    expect(RESTAURANT_QR_STANDARD_FEATURE_MANIFEST).toContain("kitchen_dispatch");
    expect(RESTAURANT_QR_STANDARD_FEATURE_MANIFEST).toContain("receipt_printer");
    expect(RESTAURANT_QR_STANDARD_FEATURE_MANIFEST).toContain("customer_display_dual_screen_hardware_supported");
    expect(FG0004_PROVISIONING_PREFLIGHT_CHECKS).toContain("store_code_fg0004_absent");
    expect(FG0004_PROVISIONING_PREFLIGHT_CHECKS).toContain("package_confirmed");
    expect(FG0004_PROVISIONING_POSTFLIGHT_CHECKS).toContain("tenant_created_once");
    expect(FG0004_PROVISIONING_POSTFLIGHT_CHECKS).toContain("no_fg0003_rows_reused");
  });

  it("generates deterministic branch codes only after a location code is supplied", () => {
    expect(buildRestaurantQrBranchCode("fg0004", "bkk")).toBe("FG0004-BKK-01");
    expect(buildRestaurantQrBranchCode("FG0004", "CNX", 2)).toBe("FG0004-CNX-02");
    expect(() => buildRestaurantQrBranchCode("FG0004", "TBD")).toThrow("restaurant_qr_location_code_invalid");
    expect(() => buildRestaurantQrBranchCode("FF0001", "BKK")).toThrow("restaurant_qr_store_code_invalid");
  });

  it("keeps Restaurant QR activation shared rather than hardcoding FG0004 business logic", () => {
    expect(restaurantQrProfile).not.toContain("FG0004");
    expect(fg0004ProvisioningSource).toContain("FG0004_RESERVED_STORE_CODE");
    expect(restaurantQrProfile).not.toContain('tenantCode: "FG0004"');
    expect(restaurantQrProfile).not.toContain('branchCode: "FG0004-');
    expect(fg0004ProvisioningSource).toContain('app_package: "com.cpipos.pos"');
    expect(fg0004ProvisioningSource).toContain("store_specific_apk: false");
    expect(restaurantQrStandardDoc).toContain("app.restaurant_qr_store_registry");
    expect(restaurantQrStandardDoc).toContain("DB writes: NO");
    expect(restaurantQrStandardDoc).toContain("FG0003 modifications: NO");
  });

  it("keeps table QR and printer identities isolated from FG0003", () => {
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST.table_configuration.isolation_rules).toEqual([
      "never_reuse_fg0003_table_ids",
      "never_reuse_fg0003_qr_tokens",
      "never_reuse_fg0003_qr_sessions",
      "fg0004_urls_resolve_only_to_fg0004_tenant_branch_table"
    ]);
    expect(FG0004_DRY_RUN_PROVISIONING_MANIFEST.printer_devices).toEqual([
      expect.objectContaining({
        printer_code: "FG0004-RECEIPT-01",
        role: "receipt",
        assignment_mode: "EXPLICIT_ONLY",
        automatic_reassignment: false
      }),
      expect.objectContaining({
        printer_code: "FG0004-KITCHEN-01",
        role: "kitchen",
        assignment_mode: "EXPLICIT_ONLY",
        automatic_reassignment: false
      })
    ]);
  });
});

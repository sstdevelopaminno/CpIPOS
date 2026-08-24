import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FG0004_GROWTH_RESTAURANT_QR_FEATURE_GAPS,
  FG0004_LIVE_PROVISIONING_PACKAGE,
  FG0004_MISSING_PHYSICAL_INPUTS
} from "../../src/lib/restaurant-qr-provisioning";
import { DEFAULT_PACKAGE_CATALOG } from "../../src/lib/subscription-catalog";

const primaryRegistryMigration = readFileSync(
  new URL("../../../../supabase/migrations/202608240002_fg0003_cancelled_order_print_claim_guard.sql", import.meta.url),
  "utf8"
);
const trialRegistryMigration = readFileSync(
  new URL("../../../../supabase/trial-data-plane/migrations/202608240002_trial_fg0003_cancelled_order_print_claim_guard.sql", import.meta.url),
  "utf8"
);
const fg0004ProvisioningSql = readFileSync(
  new URL("../../../../supabase/provisioning/fg0004_inactive_restaurant_qr_provisioning.sql", import.meta.url),
  "utf8"
);
const rolloutDoc = readFileSync(
  new URL("../../../../docs/FG0004_RESTAURANT_QR_LIVE_PROVISIONING_PACKAGE.md", import.meta.url),
  "utf8"
);

describe("FG0004 production Restaurant QR enablement prep", () => {
  it("keeps the Restaurant QR registry explicit and inactive-safe", () => {
    for (const migration of [primaryRegistryMigration, trialRegistryMigration]) {
      expect(migration).toContain("create table if not exists app.restaurant_qr_store_registry");
      expect(migration).toContain("enabled boolean not null default false");
      expect(migration).toContain("status in ('enabled','disabled','provisioning')");
      expect(migration).toContain("'FG0003'");
      expect(migration).toContain("true,");
      expect(migration).toContain("and r.enabled = true");
      expect(migration).toContain("and r.status = 'enabled'");
      expect(migration).not.toContain("'FG0004'");
      expect(migration).not.toContain("store_code like 'FG%'");
    }
  });

  it("prepares FG0004 inactive transaction without QR traffic, users, MDM, or printer hardware", () => {
    expect(fg0004ProvisioningSql).toContain("SOURCE ONLY / DO NOT EXECUTE");
    expect(fg0004ProvisioningSql).toContain("begin;");
    expect(fg0004ProvisioningSql).toContain("FG0004_RESTAURANT_QR_REGISTRY_MISSING");
    expect(fg0004ProvisioningSql).toContain("FG0004_TRIAL_TENANT_ALREADY_EXISTS");
    expect(fg0004ProvisioningSql).toContain("FG0004_TRIAL_BRANCH_ALREADY_EXISTS");
    expect(fg0004ProvisioningSql).toContain("FG0004_POS_SKELETON_POSTFLIGHT_FAILED");
    expect(fg0004ProvisioningSql).toContain("public.trial_tenant_scopes");
    expect(fg0004ProvisioningSql).toContain("public.trial_branch_scopes");
    expect(fg0004ProvisioningSql).toContain("'เลิศรส 108 เมนู'");
    expect(fg0004ProvisioningSql).toContain("'FG0004-RBR-01'");
    expect(fg0004ProvisioningSql).toContain("from generate_series(1, 20)");
    expect(fg0004ProvisioningSql).toContain("'FG0004-POS-01'");
    expect(fg0004ProvisioningSql).toContain("'pos_skeletons'");
    expect(fg0004ProvisioningSql).toContain("false,");
    expect(fg0004ProvisioningSql).toContain("'provisioning'");
    expect(fg0004ProvisioningSql).not.toContain("insert into public.table_qr_sessions");
    expect(fg0004ProvisioningSql).not.toContain("insert into public.users_profiles");
    expect(fg0004ProvisioningSql).not.toContain("insert into public.printer_devices");
    expect(fg0004ProvisioningSql).not.toContain("insert into public.printer_device_assignments");
  });

  it("matches the requested FG0004 store, branch, table, device, printer, and role plan", () => {
    expect(FG0004_LIVE_PROVISIONING_PACKAGE).toMatchObject({
      store_code: "FG0004",
      display_name: "เลิศรส 108 เมนู",
      branch_code: "FG0004-RBR-01",
      branch_name: "เลิศรส 108 เมนู ราชบุรี",
      province: "ราชบุรี",
      package_code: "growth",
      package_name: "Growth",
      initial_state: "inactive/provisioning",
      restaurant_qr_registry: {
        enabled: false,
        status: "provisioning",
        wildcard_enabled: false,
        fg_prefix_auto_enabled: false
      }
    });
    expect(FG0004_LIVE_PROVISIONING_PACKAGE.table_codes).toHaveLength(20);
    expect(FG0004_LIVE_PROVISIONING_PACKAGE.table_codes[0]).toBe("T01");
    expect(FG0004_LIVE_PROVISIONING_PACKAGE.table_codes[19]).toBe("T20");
    expect(FG0004_LIVE_PROVISIONING_PACKAGE.pos_skeleton).toMatchObject({
      device_code: "FG0004-POS-01",
      display_mode: "single_screen",
      status: "inactive",
      mdm_enrolled: false
    });
    expect(FG0004_LIVE_PROVISIONING_PACKAGE.printer_slots).toEqual([
      expect.objectContaining({ slot_code: "RECEIPT-01", role: "receipt", hardware_identity: "TBD", automatic_reassignment: false }),
      expect.objectContaining({ slot_code: "KITCHEN-01", role: "kitchen", hardware_identity: "TBD", automatic_reassignment: false })
    ]);
    expect(FG0004_LIVE_PROVISIONING_PACKAGE.role_model).toEqual(["OWNER", "STAFF", "KITCHEN"]);
  });

  it("reports Growth package gaps without bypassing subscription gates", () => {
    const growth = DEFAULT_PACKAGE_CATALOG.find((pkg) => pkg.code === "growth");
    expect(growth?.isActive).toBe(true);
    expect(growth?.includedFeatureCodes).toContain("core_pos_sales");
    expect(growth?.includedFeatureCodes).toContain("receipt_reprint_history");
    for (const featureCode of FG0004_GROWTH_RESTAURANT_QR_FEATURE_GAPS) {
      expect(growth?.includedFeatureCodes).not.toContain(featureCode);
    }
    expect(FG0004_GROWTH_RESTAURANT_QR_FEATURE_GAPS).toEqual([
      "table_management",
      "qr_table_ordering",
      "kitchen_printing"
    ]);
  });

  it("documents execution order, rollback, and no-live-execution constraints", () => {
    expect(rolloutDoc).toContain("Do not deploy");
    expect(rolloutDoc).toContain("enabled=false/status=provisioning");
    expect(rolloutDoc).toContain("Growth Feature Gate Check");
    expect(FG0004_LIVE_PROVISIONING_PACKAGE.no_live_execution).toEqual({
      apply_migration: false,
      insert_fg0004: false,
      deploy_vercel: false,
      activate_qr: false,
      generate_customer_qr_codes: false,
      create_users: false,
      enroll_mdm: false,
      assign_printers: false,
      modify_fg0003: false,
      modify_other_stores: false
    });
    expect(FG0004_MISSING_PHYSICAL_INPUTS).toContain("printer transport: USB/Bluetooth/LAN");
    expect(FG0004_MISSING_PHYSICAL_INPUTS).toContain("opening date/time");
  });
});
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/20260914040000_custom_bundle_products_entitlement.sql"),
  "utf8",
);

describe("CUSTOM bundle_products entitlement migration", () => {
  it("is guarded for databases without the subscription catalog", () => {
    expect(migration).toContain("to_regclass('public.subscription_packages')");
    expect(migration).toContain("to_regclass('public.subscription_package_features')");
  });

  it("enables bundle_products only for CUSTOM without changing Starter", () => {
    expect(migration).toContain("'bundle_products'");
    expect(migration).toContain("lower(code) = 'custom'");
    expect(migration).toContain("included = true");
    expect(migration).not.toContain("lower(code) = 'starter'");
  });

  it("is idempotent", () => {
    expect(migration).toContain("on conflict (package_id, feature_code)");
    expect(migration).toContain("do update");
  });
});

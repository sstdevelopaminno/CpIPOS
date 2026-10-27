import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("tenant Android developer security policy", () => {
  const route = source("src/app/api/pos/android-security-policy/route.ts");
  const migration = source("../../supabase/migrations/20261027033000_tenant_android_developer_options_security_policy.sql");
  it("requires an active scoped POS session and never trusts a client tenant id", () => {
    expect(route).toContain("requirePosSessionForNonSaleRecovery()");
    expect(route).toContain("scope.session.tenant_id");
    expect(route).not.toContain('searchParams.get("tenant_id")');
    expect(route).toContain('.eq("tenant_id", tenantId)');
    expect(route).not.toContain("export async function PATCH");
  });
  it("has a default-off, RLS-protected tenant policy", () => {
    expect(migration).toContain("enforce_developer_options_off boolean NOT NULL DEFAULT false");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL");
    expect(route).toContain("android_security_policy_unavailable");
    expect(route).toContain('"private, no-store"');
  });
});

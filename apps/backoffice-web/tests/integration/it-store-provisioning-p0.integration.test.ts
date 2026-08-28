import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const route = source("../../src/app/api/it-admin/v1/store-provisioning/route.ts");
const service = source("../../src/lib/services/it-admin/store-provisioning-service.ts");
const consoleUi = source("../../src/components/it-admin/store-provisioning-console.tsx");
const tenantsPage = source("../../src/app/(it-admin)/it-admin/tenants/page.tsx");
const migration = source("../../../../supabase/migrations/20260828121000_it_store_provisioning_p0.sql");

describe("IT Store Provisioning P0", () => {
  it("keeps the write endpoint restricted to IT Admin and exposes the request id for safe retries", () => {
    expect(route).toContain("requireItAdmin()");
    expect(route).toContain('x-provisioning-request-id');
    expect(route).not.toContain("requireItSupport()");
  });

  it("provisions the database core atomically with a service-role-only idempotency ledger", () => {
    expect(migration).toContain("create table if not exists public.it_store_provisioning_requests");
    expect(migration).toContain("request_key uuid not null unique");
    expect(migration).toContain("create or replace function public.provision_it_store_core");
    expect(migration).toContain("security definer");
    expect(migration).toContain("revoke all on function public.provision_it_store_core");
    expect(migration).toContain("grant execute on function public.provision_it_store_core");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("provisioning_request_payload_mismatch");
    expect(migration).toContain("return v_existing.result");
    expect(migration).toContain("insert into public.branch_login_policies");
    expect(migration).toContain("require_registered_device");
    expect(migration).toContain("insert into public.tenant_subscription_contracts");
  });

  it("never sends or persists the Owner PIN in the core provisioning RPC payload or ledger", () => {
    expect(migration).not.toMatch(/pin_hash|plaintext_pin|owner_pin|p_pin/i);
    expect(service).toContain("bcrypt.hash(input.pin, 12)");
    expect(service).not.toContain("p_pin:");
    expect(service).not.toContain("pin: pin");
    expect(service).not.toContain("pin,\n        request_id");
  });

  it("uses Supabase Auth as identity source and binds the Owner to the POS profile and initial branch", () => {
    expect(service).toContain("supabase.auth.admin.createUser");
    expect(service).toContain('.from("users_profiles")');
    expect(service).toContain('.from("pos_user_profiles")');
    expect(service).toContain('.from("user_branch_roles")');
    expect(service).toContain('role: "owner"');
    expect(service).toContain('is_default: true');
    expect(service).toContain('status: "ready_for_device_enrollment"');
  });

  it("keeps retries idempotent and does not silently overwrite an existing Owner PIN or employee code", () => {
    expect(service).toContain("owner_pin_conflict_existing_identity");
    expect(service).toContain("owner_employee_code_conflict");
    expect(service).toContain("owner_employee_code_request_mismatch");
    expect(service).toContain('status: "owner_failed"');
    expect(consoleUi).toContain("Request ID เดิม");
    expect(consoleUi).toContain("request_id: requestId");
  });

  it("mounts the provisioning console only for IT Admin and blocks custom packages from fast provisioning", () => {
    expect(tenantsPage).toContain('context.auth.platformRole === "it_admin"');
    expect(tenantsPage).toContain("isItAdmin ? <StoreProvisioningConsole packages={packages} /> : null");
    expect(consoleUi).toContain('item.quota_mode !== "standard"');
    expect(consoleUi).toContain("Custom package ไม่เปิดผ่าน Fast Provisioning");
    expect(consoleUi).toContain('fetch("/api/it-admin/v1/store-provisioning"');
  });
});

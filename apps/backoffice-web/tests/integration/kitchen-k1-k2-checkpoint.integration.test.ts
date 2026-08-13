import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createKitchenZoneSession,
  KITCHEN_ZONE_SESSION_COOKIE,
  readKitchenZoneSession
} from "@/lib/server/kitchen-zone-session";

const unlockRouteSource = readFileSync(new URL("../../src/app/api/pos/kitchen/unlock/route.ts", import.meta.url), "utf8");
const queueRouteSource = readFileSync(new URL("../../src/app/api/pos/kitchen/queue/route.ts", import.meta.url), "utf8");
const kdsSource = readFileSync(new URL("../../src/components/kitchen/kitchen-kds.tsx", import.meta.url), "utf8");
const configServiceSource = readFileSync(new URL("../../src/lib/services/kitchen-config-service.ts", import.meta.url), "utf8");
const routingServiceSource = readFileSync(new URL("../../src/lib/services/kitchen-routing-service.ts", import.meta.url), "utf8");
const routedPrintSource = readFileSync(new URL("../../src/lib/printing/routed-print-service.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../../../../supabase/migrations/20260812192703_kitchen_k1_foundation.sql", import.meta.url), "utf8");

function cookieStore(value: string) {
  return {
    get: (name: string) => (name === KITCHEN_ZONE_SESSION_COOKIE ? { value } : undefined)
  };
}

describe("Kitchen K1/K2 checkpoint security and contracts", () => {
  beforeEach(() => {
    process.env.POS_SESSION_HANDOFF_SECRET = "test-kitchen-session-secret";
    delete process.env.KITCHEN_ZONE_SESSION_SECRET;
  });

  it("creates a tamper-resistant Kitchen zone session bound to tenant and branch", () => {
    const token = createKitchenZoneSession({
      tenantId: "tenant-1",
      branchId: "branch-1",
      kitchenZoneId: "zone-1",
      ttlSeconds: 300
    });

    expect(readKitchenZoneSession(cookieStore(token), { tenantId: "tenant-1", branchId: "branch-1" })).toMatchObject({
      tenant_id: "tenant-1",
      branch_id: "branch-1",
      kitchen_zone_id: "zone-1"
    });
    expect(readKitchenZoneSession(cookieStore(token), { tenantId: "tenant-1", branchId: "branch-2" })).toBeNull();

    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(readKitchenZoneSession(cookieStore(tampered), { tenantId: "tenant-1", branchId: "branch-1" })).toBeNull();
  });

  it("does not store raw Kitchen access codes in the browser session token", () => {
    const token = createKitchenZoneSession({
      tenantId: "tenant-1",
      branchId: "branch-1",
      kitchenZoneId: "zone-1",
      ttlSeconds: 300
    });

    expect(token).not.toContain("123456");
    expect(unlockRouteSource).not.toContain("value: accessCode");
    expect(unlockRouteSource).not.toContain("access_code=");
  });

  it("validates unlock codes against active same-branch KDS-enabled zones", () => {
    expect(unlockRouteSource).toContain('requiredPermission: "sales:view"');
    expect(unlockRouteSource).toContain('.eq("tenant_id", auth.tenantId!)');
    expect(unlockRouteSource).toContain('.eq("branch_id", auth.branchId!)');
    expect(unlockRouteSource).toContain('.eq("access_code", accessCode)');
    expect(unlockRouteSource).toContain('.eq("is_active", true)');
    expect(unlockRouteSource).toContain('.eq("kds_enabled", true)');
    expect(unlockRouteSource).toContain("writeKitchenZoneSession");
  });

  it("derives queue zone authority from the signed Kitchen session only", () => {
    expect(queueRouteSource).toContain("readKitchenZoneSession");
    expect(queueRouteSource).toContain("kitchen_zone_session_required");
    expect(queueRouteSource).toContain("requestedZoneId && requestedZoneId !== zoneSession.kitchen_zone_id");
    expect(queueRouteSource).toContain("const zoneId = zoneSession.kitchen_zone_id");
    expect(queueRouteSource).not.toContain('get("cpipos_kds_zone_id")');
  });

  it("keeps KDS alerts scoped, deduped, bounded, and timer-driven", () => {
    expect(kdsSource).toContain('new Set(["new", "add"])');
    expect(kdsSource).toContain("baselineReadyRef");
    expect(kdsSource).toContain("ticket.zone?.kds_enabled === true");
    expect(kdsSource).toContain("ticket.zone?.id === unlockedZone?.id");
    expect(kdsSource).toContain("SEEN_TICKET_LIMIT = 300");
    expect(kdsSource).toContain("current.open ? current.count + increment : increment");
    expect(kdsSource).toContain("window.setTimeout");
    expect(kdsSource).toContain("ALERT_DURATION_MS = 15_000");
    expect(kdsSource).toContain("stopAlertSound");
    expect(kdsSource).toContain("window.clearInterval");
    expect(kdsSource).toContain("window.clearTimeout");
    expect(kdsSource).toContain("/sounds/kitchen-alert.wav");
    expect(kdsSource).not.toContain("http://");
    expect(kdsSource).not.toContain("https://");
    expect(kdsSource).not.toContain("getUserMedia");
  });

  it("keeps K1 schema and service contracts for access code, queue, routing, and printing", () => {
    expect(migrationSource).toContain("add column if not exists access_code text");
    expect(migrationSource).toContain("check (access_code ~ '^[0-9]{6}$')");
    expect(migrationSource).toContain("ux_kitchen_zones_scope_access_code");
    expect(migrationSource).toContain("on public.kitchen_zones(tenant_id, branch_id, access_code)");
    const accessCodeGenerator = migrationSource.slice(
      migrationSource.indexOf("create or replace function app.generate_kitchen_access_code()"),
      migrationSource.indexOf("do $$", migrationSource.indexOf("create or replace function app.generate_kitchen_access_code()"))
    );
    expect(accessCodeGenerator).toContain("gen_random_bytes(4)");
    expect(accessCodeGenerator).not.toContain("count(*)");
    expect(accessCodeGenerator).not.toContain("max(access_code");
    expect(migrationSource).toContain("KITCHEN_ACCESS_CODE_COLLISION_RETRY_EXHAUSTED");
    expect(migrationSource).toContain("returns table(kitchen_ticket_id uuid, zone_id uuid, print_job_id uuid, queue_no integer, round_no integer)");
    expect(configServiceSource).toContain("access_code");
    expect(configServiceSource).toContain("kds_enabled");
    expect(routingServiceSource).toContain("queueRoutedKitchenTicketPrint");
    expect(routedPrintSource).toContain("zone_id: string");
  });
});

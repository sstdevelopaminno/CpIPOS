import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createKitchenZoneSession,
  KITCHEN_ZONE_SESSION_COOKIE,
  readKitchenZoneSession
} from "@/lib/server/kitchen-zone-session";

const unlockRouteSource = readFileSync(new URL("../../src/app/api/pos/kitchen/unlock/route.ts", import.meta.url), "utf8");
const queueRouteSource = readFileSync(new URL("../../src/app/api/pos/kitchen/queue/route.ts", import.meta.url), "utf8");
const kdsBytes = readFileSync(new URL("../../src/components/kitchen/kitchen-kds.tsx", import.meta.url));
const kdsSource = new TextDecoder("utf-8", { fatal: true }).decode(kdsBytes);
const kitchenSessionSource = readFileSync(new URL("../../src/lib/server/kitchen-zone-session.ts", import.meta.url), "utf8");
const tableQrSource = readFileSync(new URL("../../src/lib/table-qr-ordering.ts", import.meta.url), "utf8");
const posSalesRouteSource = readFileSync(new URL("../../src/app/api/pos/sales/route.ts", import.meta.url), "utf8");
const configServiceSource = readFileSync(new URL("../../src/lib/services/kitchen-config-service.ts", import.meta.url), "utf8");
const routingServiceSource = readFileSync(new URL("../../src/lib/services/kitchen-routing-service.ts", import.meta.url), "utf8");
const routedPrintSource = readFileSync(new URL("../../src/lib/printing/routed-print-service.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../../../../supabase/migrations/20260812192703_kitchen_k1_foundation.sql", import.meta.url), "utf8");
const migrationLower = migrationSource.toLowerCase();

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
    const token = createKitchenZoneSession({ tenantId: "tenant-1", branchId: "branch-1", kitchenZoneId: "zone-1", ttlSeconds: 300 });
    expect(readKitchenZoneSession(cookieStore(token), { tenantId: "tenant-1", branchId: "branch-1" })).toMatchObject({
      tenant_id: "tenant-1",
      branch_id: "branch-1",
      kitchen_zone_id: "zone-1"
    });
    expect(readKitchenZoneSession(cookieStore(token), { tenantId: "tenant-1", branchId: "branch-2" })).toBeNull();
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(readKitchenZoneSession(cookieStore(tampered), { tenantId: "tenant-1", branchId: "branch-1" })).toBeNull();
    expect(kitchenSessionSource).toContain("cpipos:kitchen-zone:v1:");
  });

  it("does not store raw Kitchen access codes in the browser session token", () => {
    const token = createKitchenZoneSession({ tenantId: "tenant-1", branchId: "branch-1", kitchenZoneId: "zone-1", ttlSeconds: 300 });
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

  it("keeps KDS alerts scoped, deduped, bounded, timer-driven, and valid UTF-8", () => {
    expect(kdsSource).toContain('new Set(["new", "add"])');
    expect(kdsSource).toContain("baselineReadyRef");
    expect(kdsSource).toContain("ticket.zone?.kds_enabled === true");
    expect(kdsSource).toContain("ticket.zone?.id === unlockedZone?.id");
    expect(kdsSource).toContain("SEEN_TICKET_LIMIT = 300");
    expect(kdsSource).toContain("current.open ? current.count + increment : increment");
    expect(kdsSource).toContain("ALERT_DURATION_MS = 15_000");
    expect(kdsSource).toContain("window.clearInterval");
    expect(kdsSource).toContain("window.clearTimeout");
    expect(kdsSource).toContain("/sounds/kitchen-alert.wav");
    expect(kdsSource).not.toContain("\\uFFFD");
    expect(kdsSource).not.toContain("http://");
    expect(kdsSource).not.toContain("https://");
    expect(kdsSource).not.toContain("getUserMedia");
  });

  it("keeps K1 access-code allocation server-side and race-safe", () => {
    expect(migrationSource).toContain("create or replace function app.assign_kitchen_zone_access_code()");
    expect(migrationSource).toContain("before insert on public.kitchen_zones");
    expect(migrationSource).toContain("'kitchen-access-code:' || new.tenant_id::text || ':' || new.branch_id::text");
    expect(migrationSource).toContain("pg_advisory_xact_lock");
    expect(migrationSource).toContain("v_attempt >= 32");
    expect(migrationSource).toContain("KITCHEN_ACCESS_CODE_COLLISION_RETRY_EXHAUSTED");
    expect(migrationSource).toContain("check (access_code ~ '^[0-9]{6}$')");
    expect(migrationSource).toContain("ux_kitchen_zones_scope_access_code");
  });

  it("does not duplicate production queue or accepted-item lock mechanisms", () => {
    expect(migrationLower).not.toContain("kitchen_queue_counters");
    expect(migrationLower).not.toContain("last_queue_no");
    expect(migrationLower).not.toContain("trg_order_items_kitchen_acceptance_lock");
    expect(migrationLower).not.toContain("prevent_pos_item_change_after_kitchen_acceptance");
    expect(migrationLower).not.toContain("create trigger trg_kitchen_ticket_queue_no");
    expect(migrationSource).toContain("queue_source','trg_kitchen_ticket_queue_no");
  });

  it("keeps queue number per order and protects later round allocation", () => {
    expect(migrationSource).toContain("select kt.queue_no into v_order_queue_no");
    expect(migrationSource).toContain("and kt.order_id = p_order_id");
    expect(migrationSource).toContain("p_tenant_id::text || ':' || p_branch_id::text || ':' || p_order_id::text || ':' || v_zone_id::text");
    expect(migrationSource).toContain("select max(kt.round_no)");
    expect(migrationSource).toContain("v_round_no := coalesce(v_zone_max_round, 0) + 1");
    expect(migrationSource).toContain("on conflict on constraint kitchen_tickets_tenant_id_branch_id_event_key_zone_id_key do nothing");
  });

  it("uses authoritative QR/POS mutations and only recovers missing Kitchen print jobs", () => {
    expect(tableQrSource).not.toContain("dispatchOrderToKitchen");
    expect(tableQrSource).not.toContain("dispatchTableQrItemsToKitchen");
    expect(tableQrSource).not.toContain(".delete()");
    expect(tableQrSource).toContain('supabase.rpc("replace_queued_dine_in_order_tx"');
    expect(tableQrSource).toContain("queueTableQrKitchenPrints");
    expect(tableQrSource).toContain("queueMissingKitchenPrintJobsForOrder");
    expect(posSalesRouteSource).toContain("queueKitchenPrintRecoveryForPosOrder");
    expect(posSalesRouteSource).toContain("queueMissingKitchenPrintJobsForOrder");
    expect(routingServiceSource).toContain("export async function queueMissingKitchenPrintJobsForOrder");
    expect(routingServiceSource).toContain('.from("kitchen_tickets")');
    expect(routingServiceSource).toContain('.from("print_jobs")');
    expect(routingServiceSource).toContain("ticketsWithJobs.has(ticket.id)");
    expect(configServiceSource).toContain("access_code");
    expect(configServiceSource).toContain("kds_enabled");
    expect(routedPrintSource).toContain("zone_id: string");
  });
});
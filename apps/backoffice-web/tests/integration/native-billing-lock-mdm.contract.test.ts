import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("Native billing lock and MDM control-plane contract",()=>{
  const overview=src("src/app/api/pos/billing/overview/route.ts");
  const requests=src("src/app/api/pos/billing/requests/route.ts");
  const runtime=src("src/app/api/pos/billing/runtime/route.ts");
  const receipt=src("src/app/api/pos/billing/receipts/[receiptId]/route.ts");
  const heartbeat=src("src/app/api/pos/device-heartbeat/route.ts");
  const ack=src("src/app/api/pos/device-commands/ack/route.ts");
  const guard=src("src/lib/pos-session-guard.ts");
  const devices=src("src/app/api/auth/devices/route.ts");
  const select=src("src/app/api/auth/devices/select/select-handler.ts");

  it("keeps billing reachable while subscription access is locked",()=>{
    for(const route of [overview,requests,runtime,receipt]){
      expect(route).toContain("requirePosSessionForShiftClose");
      expect(route).not.toContain("await requirePosSession()");
    }
    expect(overview).toContain('["owner", "manager"]');
    expect(requests).toContain('scope.session.role !== "owner"');
    expect(receipt).toContain('["owner","manager"]');
    expect(guard).toContain('throw new PosGuardError(\n        "subscription_access_locked"');
    expect(guard).toContain("await assertSubscriptionAllowsSales(scopedSession.tenant_id)");
  });

  it("keeps authenticated MDM heartbeat and acknowledgements alive during package lock",()=>{
    for(const route of [heartbeat,ack]){
      expect(route).toContain("requirePosSessionForShiftClose");
      expect(route).not.toContain("await requirePosSession()");
    }
    expect(heartbeat).toContain("pending_actions");
    expect(heartbeat).toContain("authoritative_device_code_source");
    expect(ack).toContain("device_commands");
    expect(ack).toContain("execution_status");
  });

  it("still blocks POS entry and exposes payment recovery before creating a session",()=>{
    expect(devices).toContain("evaluatePosEntryAccess");
    expect(devices).toContain("entry_access:");
    expect(devices).toContain("payment_review:");
    expect(devices).toContain("auto_select_single_device:entryAccess.allowed");
    expect(select).toContain("evaluatePosEntryAccess");
    expect(select).toContain("if(!entryAccess.allowed)");
    expect(select).toContain("expires_at:detail.expires_at");
    const accessIndex=select.indexOf("if(!entryAccess.allowed)");
    const createIndex=select.indexOf("createPosSession({");
    expect(accessIndex).toBeGreaterThan(0);
    expect(createIndex).toBeGreaterThan(accessIndex);
  });

  it("does not weaken normal sales guards",()=>{
    expect(guard).toContain("export async function requirePosSession()");
    expect(guard).toContain("export async function requireActiveShift");
    expect(guard).toContain("await assertSubscriptionAllowsSales(scope.session.tenant_id)");
  });
});

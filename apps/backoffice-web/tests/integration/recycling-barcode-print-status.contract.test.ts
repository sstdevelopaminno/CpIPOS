import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const route=src("src/app/api/pos/recycling/barcodes/print/route.ts");
const dialog=src("src/components/pos/recycling-barcode-dialog.tsx");

describe("Recycling barcode print feedback and duplicate prevention",()=>{
 it("reads one barcode label job using authenticated tenant/branch and authorized inventory scope",()=>{
  expect(route).toContain("export async function GET(request:Request)");
  expect(route).toContain('requirePermission(scope,"inventory:view")');
  expect(route).toContain("isAuthorizedRecyclingTenant(tenantId)");
  expect(route).toContain('.eq("id",jobId).eq("tenant_id",tenantId).eq("branch_id",branchId)');
  expect(route).toContain('.like("idempotency_key","recycling-barcode:%")');
  expect(route).toContain('.eq("device_code",scope.session.device_code)');
  expect(route).toContain('agent_online:agentOnline');
  expect(route).toContain('printed_means:"windows_spool_acknowledged_not_physical"');
  const statusOnly=route.slice(route.indexOf("export async function GET(request:Request)"));
  expect(statusOnly).not.toContain('.insert(');
  expect(statusOnly).not.toContain('.update(');
  expect(statusOnly).not.toContain('claimPrintJobs');
 });

 it("keeps the same request identity after network ambiguity and refuses queued duplicate button presses",()=>{
  expect(dialog).toContain("requestIdRef.current??=crypto.randomUUID()");
  expect(dialog).toContain("request_id:requestIdRef.current");
  expect(dialog).toContain('if(!valid||busy||pendingJobId||submittingRef.current)return');
  expect(dialog).toContain('disabled={busy||!valid||Boolean(pendingJobId)}');
  expect(dialog).toContain('setPendingJobId(tracking.id)');
  expect(dialog).toContain('statusRevision');
  expect(dialog).toContain('setTimeout(()=>void readStatus(),2800)');
  expect(dialog).toContain('window.dispatchEvent(new Event("cpi-windows-print-agent-wake"))');
  expect(dialog).toContain('status==="printed"');
  expect(dialog).toContain('status==="failed"');
  expect(dialog).toContain('Windows รับงานเข้าคิวเครื่องพิมพ์แล้ว');
  expect(dialog).not.toContain('body:JSON.stringify({request_id:crypto.randomUUID()');
 });
});

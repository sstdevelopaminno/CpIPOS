import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderRecyclingDailyShiftCloseHtml } from "../../src/lib/printing/recycling-daily-shift-close-slip";
const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("isolated Windows 80mm shift-open and shift-close printing",()=>{
 it("keeps open-shift printing strictly after a confirmed immutable shift/cash write",()=>{
  const ctrl=src("src/components/pos/recycling-shift-control.tsx");
  const route=src("src/app/api/pos/recycling/shifts/[shiftId]/open-print/route.ts");
  const svc=src("src/lib/printing/recycling-shift-open-print-service.ts");
  expect(ctrl).toContain('fetch("/api/pos/recycling/shifts/"+encodeURIComponent(body.data.shift.id)+"/open-print"');
  expect(ctrl.indexOf('setShift(body.data.shift);setNeedsJoin(false);'))
    .toBeLessThan(ctrl.indexOf('"/open-print"'));
  expect(ctrl).toContain('new Event("cpi-windows-print-agent-wake")');
  expect(route).toContain('requirePosSession()');
  expect(route).toContain('isAuthorizedRecyclingTenant(scope.session.tenant_id)');
  expect(route).toContain('requirePermission(scope,"shift:join")');
  expect(svc).toContain('.eq("tenant_id",tenantId).eq("branch_id",branchId)');
  expect(svc).toContain('.eq("device_code",code)');
  expect(svc).toContain('shift.data.status!=="open"');
  expect(svc).toContain('shift.data.metadata?.business_shift_mode!=="recycling_daily"');
  expect(svc).toContain('m.windows_shift_open_auto_print===true');
  expect(svc).toContain('m.target_runtime==="windows_native"&&m.windows_device_code===code');
  expect(svc).toContain('recycling-shift-open:');
  expect(svc).toContain('idempotencyKey,');
  expect(svc).toContain('printerRole:route.printer.printer_role');
  expect(svc).toContain('quarantine_replay_allowed:false');
  expect(svc).toContain('ไม่ใช่ใบเสร็จรับเงินหรือใบกำกับภาษี');
  expect(svc).not.toContain('.from("recycling_transactions").insert');
  expect(svc).not.toContain('.from("shifts").update');
 });
 it("allows 70mm printable close slip ONLY via explicit calibrated printer input",()=>{
  const stub={
   id:"d57913e6-bde7-4d4f-8b02-129a6e606cc0",
   branchName:"สาขาหลัก",openedAt:"2026-11-23T00:00:00Z",
   closedAt:"2026-11-23T12:00:00Z",
   openingCash:100,expectedCash:85,actualCash:85,
   metadata:{business_shift_mode:"recycling_daily",recycling_buy_count:2,recycling_sell_count:1,
    recycling_cash_in_minor:2500,recycling_cash_out_minor:4000}
  };
  const calibrated=renderRecyclingDailyShiftCloseHtml(stub,80,{printableWidthMm:70,offsetMm:-4});
  const previous=renderRecyclingDailyShiftCloseHtml(stub,80);
  const noClip=renderRecyclingDailyShiftCloseHtml(stub,80,{printableWidthMm:80,offsetMm:-4});
  expect(calibrated).toContain("main{width:70mm;");
  expect(calibrated).toContain("margin:0 0 0 1mm");
  expect(previous).toContain("main{width:74mm;");
  expect(noClip).toContain("main{width:74mm;");
  expect(calibrated).toContain("เงินสดต้นกะ");
  expect(calibrated).toContain("ไม่ใช่ใบเสร็จหรือใบกำกับภาษี");
 });
 it("never changes normal 58mm shift report width and Android route",()=>{
  const stub={id:"d57913e6-bde7-4d4f-8b02-129a6e606cc0",branchName:"กะ",
   openedAt:null,closedAt:null,openingCash:0,expectedCash:0,actualCash:0,metadata:{}};
  expect(renderRecyclingDailyShiftCloseHtml(stub,58,{printableWidthMm:70,offsetMm:-4}))
   .toContain("main{width:53mm;");
  const report=src("src/lib/printing/routed-print-service.ts");
  expect(report).toContain('printerRole: route.printer.printer_role');
  expect(report).toContain('purpose: "shift_report"');
  expect(report).toContain('fallbackPurposes: ["receipt"]');
 });
});

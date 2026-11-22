import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
import { buildRecyclingShiftSnapshots,recyclingSummaryChart,type ReportTransaction,type ReportShift } from "../../src/lib/recycling-summary-view-model";

const load=(file:string)=>readFileSync(resolve(process.cwd(),file),"utf8");
const report=load("src/components/pos/recycling-history-reports.tsx");
const workspace=load("src/components/pos/recycling-summary-workspace.tsx");
const loader=load("src/lib/server/recycling-history-reports.ts");
const css=load("src/app/globals.css");
const route=load("src/app/preview/pos/sales-summary/page.tsx");

const shift:ReportShift={
 id:"shift-1",branch_id:"branch-a",opened_at:"2026-11-22T04:00:00Z",
 closed_at:null,opening_cash:5000,expected_cash:null,actual_cash:null,status:"open"
};
const tx=(id:string,direction:"buy"|"sell",minor:number,status:"posted"|"voided"="posted",date="2026-11-22T04:30:00Z"):ReportTransaction=>({
 id,shift_id:"shift-1",branch_id:"branch-a",receipt_no:"RCY-"+id,
 created_at:date,counterparty_name:"ตัวอย่าง",direction,settlement:"cash",status,total_minor:minor,cogs_minor:0
});
describe("CUSTOM Recycling shift summary money audit",()=>{
 it("shows purchase expense and sale revenue separately, excludes VOID, reconciles cash drawer",()=>{
  const rows=[tx("1","buy",5325),tx("2","sell",18000),tx("3","buy",2000,"voided")];
  const [value]=buildRecyclingShiftSnapshots([shift],rows);
  expect(value.money.buyCount).toBe(1);
  expect(value.money.sellCount).toBe(1);
  expect(value.money.voidCount).toBe(1);
  expect(value.money.buyMinor).toBe(5325);
  expect(value.money.sellMinor).toBe(18000);
  expect(value.openingMinor).toBe(500000);
  expect(value.expectedMinor).toBe(512675);
  expect(value.actualMinor).toBeNull();
  expect(value.differenceMinor).toBeNull();
  expect(value.transactions).toHaveLength(3);
 });
 it("uses persisted close figure when available and computes counted cash difference",()=>{
  const [value]=buildRecyclingShiftSnapshots([
   {...shift,status:"closed",closed_at:"2026-11-22T08:00:00Z",expected_cash:4946.75,actual_cash:4940}
  ],[tx("1","buy",5325)]);
  expect(value.expectedMinor).toBe(494675);
  expect(value.actualMinor).toBe(494000);
  expect(value.differenceMinor).toBe(-675);
 });
 it("does not count voided bills as money in the chart, and groups by Bangkok date",()=>{
  const rows=[tx("1","buy",5325),tx("2","sell",4000,"posted","2026-11-21T18:00:00Z"),
   tx("3","sell",3000,"voided")];
  const day=recyclingSummaryChart(rows,"day","2026-11-22","2026-11-22");
  expect(day).toHaveLength(6);
  expect(day.reduce((sum,bucket)=>sum+bucket.buyMinor,0)).toBe(5325);
  expect(day.reduce((sum,bucket)=>sum+bucket.sellMinor,0)).toBe(4000);
  const month=recyclingSummaryChart(rows,"month","2026-11-01","2026-11-30");
  expect(month).toHaveLength(30);
  expect(month.find(p=>p.key==="2026-11-22")?.sellMinor).toBe(4000);
 });
});

describe("CUSTOM Recycling full width reports and popup actions",()=>{
 it("keeps ordinary POS router unchanged while removing Recycling summary outer card",()=>{
  expect(route).toContain('if (await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id) && !canUseStandard)');
  expect(route).toContain('<RecyclingHistoryReports scope={posMenuScope} kind="summary"');
  expect(route).toContain('<PosSalesSummaryDashboard');
  expect(report).toContain('kind==="summary"?"recycling-summary-layout');
  expect(report).toContain('<RecyclingSummaryWorkspace report={report}');
  expect(css).toContain('.pos-app-content-area:has(> .recycling-summary-layout)');
  expect(css).toContain('padding: 0 !important');
 });
 it("shows overview chart modal, complete shift detail, and print actions in-place",()=>{
  expect(workspace).toContain('data-testid="recycling-summary-chart-open"');
  expect(workspace).toContain('data-testid="recycling-summary-chart"');
  expect(workspace).toContain('data-testid="recycling-summary-chart-metrics"');
  expect(workspace).toContain('data-testid="recycling-summary-shift-table"');
  expect(workspace).toContain('data-testid="recycling-summary-shift-row"');
  expect(workspace).toContain('ดูกะ / พิมพ์');
  expect(workspace).toContain('role="dialog" aria-modal="true"');
  expect(workspace).toContain('data-testid="recycling-shift-modal-transactions"');
  expect(workspace).toContain('data-testid="recycling-shift-print-browser"');
  expect(workspace).toContain('window.print()');
  expect(workspace).toContain('<RecyclingShiftPrintButton shiftId={selected.shift.id}');
  expect(workspace).toContain('selected.shift.status==="closed"');
  expect(workspace).toContain('selected.shift.branch_id===report.sessionBranchId');
  expect(workspace).toContain('กะยังเปิดอยู่ · พิมพ์เป็นรายงานชั่วคราวเท่านั้น');
  expect(workspace).toContain('RecyclingReceiptDialog');
  expect(css).toContain('body:has([data-recycling-shift-print])');
 });
 it("shift drilldown sees both directions regardless of the overview filter and excludes VOID from cash",()=>{
  expect(loader).toContain('let shiftTransactions:RecyclingTransaction[]=[];');
  expect(loader).toContain('shiftTransactions=transactions.filter');
  expect(loader).toContain('selectedShiftIds.has(t.shift_id!)');
  expect(loader).toContain('totals:sumRecyclingReportMoney(kind==="summary"?matching:transactions)');
  expect(workspace).toContain('report.shiftTransactions');
  expect(workspace).not.toContain('.update(');
  expect(workspace).not.toContain('.insert(');
  expect(workspace).not.toContain('.delete(');
 });
});

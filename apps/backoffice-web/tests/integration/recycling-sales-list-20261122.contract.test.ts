import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sumRecyclingReportMoney } from "../../src/lib/recycling-report-calculation";

const read=(file:string)=>readFileSync(resolve(process.cwd(),file),"utf8");
const route=read("src/app/preview/pos/sales-list/page.tsx");
const page=read("src/components/pos/recycling-sales-list-page-content.tsx");
const exporter=read("src/components/pos/recycling-sales-list-export.tsx");
const source=read("src/lib/server/recycling-history-reports.ts");
const ordinary=read("src/components/pos-preview/pos-sales-list-workspace.tsx");

describe("CUSTOM Recycling sales-list: purchase and sale isolation",()=>{
  it("routes only entitled Recycling tenants into an independent sales-list component",()=>{
    expect(route).toContain('await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/sales-list")');
    expect(route).toContain('if(await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id) && !canUseStandard)');
    expect(route).toContain('await requirePosPagePermission("sales:list:view")');
    expect(route).toContain("<RecyclingSalesListPageContent");
    expect(route).toContain('options?.report_mode==="standard"');
    expect(route).toContain("isAuthorizedCustomGeneralSaleTenant");
    expect(route).toContain("const basicOptical");
    expect(route).toContain("<PosOpticalBasicSalesHistory");
    expect(route).toContain("<PosSalesListWorkspace");
    expect(route).toContain("loadPosSalesListData");
    expect(ordinary).not.toContain("recycling_transactions");
  });

  it("reads only transaction ledger, never ordinary orders or mutable payment endpoints",()=>{
    expect(page).toContain('loadRecyclingHistoryReport(scope,"receipts"');
    expect(page).toContain('direction:"all",status:"all",page:"1"');
    expect(source).toContain('db.from("recycling_transactions")');
    expect(source).toContain('.eq("tenant_id",scope.session.tenant_id).in("branch_id",ids)');
    expect(source).toContain('getRecyclingStockBranches(scope)');
    expect(page).toContain('db.from("recycling_transaction_lines")');
    expect(page).toContain('.eq("tenant_id",scope.session.tenant_id)');
    expect(page).toContain('total= sumRecyclingReportMoney(report.transactions)');
    expect(page).not.toContain('.insert(');
    expect(page).not.toContain('.update(');
    expect(page).not.toContain('.delete(');
  });

  it("shows buy/sell tabs and a cashier-friendly monetary register in Thai",()=>{
    expect(page).toContain('data-testid="recycling-sales-list-direction-tabs"');
    expect(page).toContain('data-testid="recycling-sales-list-table"');
    expect(page).toContain('data-testid="recycling-sales-list-metrics"');
    expect(page).toContain('data-testid="recycling-sales-list-filters"');
    for(const text of [
      "รายการซื้อ–ขายวัสดุรีไซเคิล","รับซื้อเข้าร้าน","ขายออก",
      "เงินสดจ่ายรับซื้อ","เงินสดรับจากการขายออก",
      "เลขเอกสาร","ผู้ขาย / ผู้ซื้อ","รายการวัสดุ",
      "วิธีรับ–จ่ายเงิน","ยกเลิก (VOID)","ดู / พิมพ์เอกสาร"
    ])expect(page).toContain(text);
    expect(page).toContain('status==="all"||t.status===status');
    expect(page).toContain('direction==="all"||t.direction===direction');
    expect(page).toContain('Math.ceil(filtered.length/size)');
    expect(page).toContain("href({page:String(page+1)})");
  });

  it("does not treat scrap purchases as sales or VOID transactions as real cash",()=>{
    const examples=[
      {direction:"buy" as const,settlement:"cash" as const,status:"posted" as const,total_minor:500_00,cogs_minor:0},
      {direction:"buy" as const,settlement:"credit" as const,status:"posted" as const,total_minor:200_00,cogs_minor:0},
      {direction:"sell" as const,settlement:"cash" as const,status:"posted" as const,total_minor:1000_00,cogs_minor:600_00},
      {direction:"sell" as const,settlement:"bank_transfer" as const,status:"voided" as const,total_minor:900_00,cogs_minor:600_00}
    ];
    const sums=sumRecyclingReportMoney(examples);
    expect(sums).toMatchObject({
      buyCount:2,sellCount:1,voidCount:1,
      buyMinor:700_00,sellMinor:1000_00,cashOutMinor:500_00,cashInMinor:1000_00,
      creditOutMinor:200_00,transferInMinor:0
    });
    expect(page).toContain('settlements={cash:"เงินสด",bank_transfer:"ระบุโอนเงิน · รอตรวจหลักฐาน",credit:"เครดิต / ค้างชำระ"}');
  });

  it("keeps reports read only and exports no formula-injection CSV",()=>{
    expect(exporter).toContain("quoteCell");
    expect(exporter).toContain("replace(/\"/g");
    expect(exporter).toContain("URL.createObjectURL");
    expect(exporter).toContain("recycling-buy-sell-");
    expect(exporter).toContain('type="button" onClick={exportCsv}');
    expect(exporter).not.toContain("fetch(");
    expect(page).toContain("rows={exportRows}");
    expect(page).not.toContain("recycling_post_transaction");
  });
});

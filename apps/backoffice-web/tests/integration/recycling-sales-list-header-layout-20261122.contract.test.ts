import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const load=(file:string)=>readFileSync(resolve(process.cwd(),file),"utf8");
const recycling=load("src/components/pos/recycling-sales-list-page-content.tsx");
const css=load("src/app/globals.css");
const router=load("src/app/preview/pos/sales-list/page.tsx");
const mainSales=load("src/components/pos-preview/pos-sales-list-workspace.tsx");

describe("CUSTOM Recycling sales-list compact program-style layout",()=>{
  it("moves all/buy/sell tabs into the header directly before the Today action",()=>{
    const start=recycling.indexOf('return <main className="recycling-sales-list-layout');
    const header=recycling.indexOf("<header",start);
    const headerEnd=recycling.indexOf("</header>",header);
    const tabs=recycling.indexOf('data-testid="recycling-sales-list-direction-tabs"',header);
    const all=recycling.indexOf('["all","ทั้งหมด",countAll]',header);
    const buy=recycling.indexOf('["buy","รับซื้อเข้าร้าน",countBuy]',header);
    const sell=recycling.indexOf('["sell","ขายออก",countSell]',header);
    const today=recycling.indexOf('{quick("day","วันนี้")}',header);
    const month=recycling.indexOf('{quick("month","รายเดือน")}',header);
    const year=recycling.indexOf('{quick("year","รายปี")}',header);
    const exportButton=recycling.indexOf("<RecyclingSalesListExport",header);
    expect(header).toBeGreaterThan(start);
    expect(tabs).toBeGreaterThan(header);
    expect(all).toBeGreaterThan(tabs);
    expect(all).toBeLessThan(buy);
    expect(buy).toBeLessThan(sell);
    expect(sell).toBeLessThan(today);
    expect(today).toBeLessThan(month);
    expect(month).toBeLessThan(year);
    expect(year).toBeLessThan(exportButton);
    expect(exportButton).toBeLessThan(headerEnd);
    expect(recycling.split('data-testid="recycling-sales-list-direction-tabs"').length-1).toBe(1);
  });

  it("uses the application viewport instead of a nested centered card",()=>{
    expect(recycling).toContain('recycling-sales-list-layout flex h-full min-h-0 w-full min-w-0 flex-col bg-white');
    expect(recycling).toContain('flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white');
    expect(recycling).toContain('border-b border-slate-200 bg-gradient-to-r');
    expect(recycling).not.toContain('min-h-[calc(100dvh-7rem)]');
    expect(css).toContain('.pos-app-content-area:has(> .recycling-sales-list-layout)');
    expect(css).toContain('padding: 0 !important;');
    expect(css).toContain('max-width: none;');
    expect(css).toContain('.recycling-sales-list-layout {');
    expect(css).toContain('overflow-y: auto;');
    expect(recycling).toContain('md:mx-4');
  });

  it("leaves standard POS and Optical sales-list behavior unchanged",()=>{
    expect(router).toContain('if(await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id) && !canUseStandard)');
    expect(router).toContain('<RecyclingSalesListPageContent');
    expect(router).toContain('<PosOpticalBasicSalesHistory');
    expect(router).toContain('<PosSalesListWorkspace');
    expect(mainSales).not.toContain("recycling-sales-list-direction-tabs");
    expect(mainSales).not.toContain("recycling-sales-list-layout");
  });

  it("preserves filters, real totals, receipt links and VOID exclusion without mutations",()=>{
    expect(recycling).toContain('data-testid="recycling-sales-list-filters"');
    expect(recycling).toContain('data-testid="recycling-sales-list-table"');
    expect(recycling).toContain('sumRecyclingReportMoney(report.transactions)');
    expect(recycling).toContain('status==="all"||t.status===status');
    expect(recycling).toContain('direction==="all"||t.direction===direction');
    expect(recycling).toContain('"/preview/pos/recycling/receipts/"+encodeURIComponent(t.id)');
    expect(recycling).toContain('ยกเลิก {total.voidCount} บิล (ไม่รวมยอดรับ–จ่ายจริง)');
    expect(recycling).not.toContain(".insert(");
    expect(recycling).not.toContain(".delete(");
    expect(recycling).not.toContain(".update(");
  });
});

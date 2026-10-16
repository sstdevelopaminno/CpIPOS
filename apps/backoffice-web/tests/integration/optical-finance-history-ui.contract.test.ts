import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const read=(name:string)=>readFileSync(new URL("../../src/"+name,import.meta.url),"utf8");

describe("CUSTOM Optical reports: presentation-only, normal packages unchanged",()=>{
  it("gates the three opt-in report surfaces server-side",()=>{
    const pages=[
      "app/preview/pos/sales-summary/page.tsx",
      "app/preview/pos/receipts/page.tsx",
      "app/preview/pos/product-sales/page.tsx"
    ];
    for(const path of pages){
      const code=read(path);
      expect(code).toContain("requireOpticalRetailEntitlement");
      expect(code).toContain("opticalMode=");
      expect(code).toContain("assertPosMenuPageAllowed");
    }
  });
  it("gives Optical summary at-a-glance indicators without fabricating deposits",()=>{
    const source=read("components/pos-preview/pos-sales-summary-dashboard.tsx");
    expect(source).toContain("opticalMode ? (");
    expect(source).toContain('data-testid="optical-sales-summary-kpis"');
    expect(source).toContain("payload.summary.grossSales");
    expect(source).toContain("payload.summary.cashTotal");
    expect(source).toContain("payload.currencyBuckets");
    expect(source).not.toContain("estimatedDeposit");
  });
  it("preserves receipt reprinting and improves empty histories",()=>{
    const source=read("components/pos-preview/pos-receipts-workspace.tsx");
    expect(source).toContain("useState(opticalMode)");
    expect(source).toContain("CUSTOM · OPTICAL RECEIPTS");
    expect(source).toContain("ไม่พบใบเสร็จตามวันที่หรือสถานะที่เลือก");
    expect(source).toContain("reprint");
    expect(source).toContain("pagination.total_pages");
  });
  it("renders each product sale in its stored currency, not a tenant-wide conversion",()=>{
    const data=read("app/api/pos/product-sales/route.ts");
    const view=read("components/pos-preview/product-sales-workspace.tsx");
    expect(data).toContain('orderCurrencyFromMetadata(order.metadata)');
    expect(data).toContain('metadata');
    expect(view).toContain("row.currency_code ?? \"THB\"");
    expect(view).toContain("opticalCurrencyTotals");
    expect(view).toContain('data-testid="optical-product-sales-kpis"');
    expect(view).toContain("order_status !== \"completed\"");
    expect(view).toContain("opticalMode ? formatSalesMoney");
  });
});
import { readFileSync } from "node:fs";
import { describe,it,expect } from "vitest";
const read=(p:string)=>readFileSync(new URL("../../src/"+p,import.meta.url),"utf8");
describe("RW stock UI isolation",()=>{
  it("requires the explicit CUSTOM profile and existing stock permission",()=>{
    expect(read("lib/server/custom-stock-ui-policy.ts")).toContain('if(isRetailWholesaleProfile(plan?.code,modes))return "retail_wholesale"');
    const page=read("app/preview/pos/stock/page.tsx");
    expect(page).toContain('requirePosPagePermission("inventory:view")');
    expect(page).toContain('customStockMode === "retail_wholesale"');
    expect(page).toContain('loadProductMediaMap({tenantId:auth.tenantId!,branchId:selectedBranchId');
    expect(page).toContain("rw-warehouse-not-active");
  });
  it("only uses RW prices in RW view and keeps existing catalogue actions",()=>{
    const table=read("components/pos-preview/stock-products-table.tsx");
    for(const label of ["บาร์โค้ด","รูปสินค้า","ชื่อสินค้า","จำนวนสต๊อก","ราคาต้นทุน","ราคาขายออนไลน์","ราคาขายส่ง"])expect(table).toContain(label);
    expect(table).toContain("retailWholesale&&canManageCatalog");
    expect(table).toContain("EditProductPopupButton");
    expect(table).toContain("StockRowActionIcons");
    expect(read("app/globals.css")).toContain(".pos-app-content-area:has(> .rw-stock-layout)");
  });
});

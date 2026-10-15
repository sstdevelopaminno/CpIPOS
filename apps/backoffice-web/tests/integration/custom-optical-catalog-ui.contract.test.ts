import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const text=(p:string)=>readFileSync(new URL("../../src/"+p,import.meta.url),"utf8");

describe("CUSTOM Optical catalog UI and API isolation",()=>{
  it("retains legacy restaurant + retail stock page and hides old Optical read-only notice",()=>{
    const page=text("app/preview/pos/stock/custom/page.tsx");
    const legacy=text("app/preview/pos/stock/page.tsx");
    expect(page).toContain("return <OpticalStockWorkspace rows={enriched}");
    expect(page).toContain("optical ? collectPagedShiftRows<CatalogRow>");
    expect(page).toContain("collectShiftRowsForIds<RecipeRow>");
    expect(page).toContain('if(!optical)return true;');
    expect(legacy).toContain("<StockProductsTable");
  });
  it("shows page buttons, filter, bulk editable table and CRUD modal on Optical only",()=>{
    const ui=text("components/pos/optical-stock-workspace.tsx");
    expect(ui).toContain('data-testid="custom-optical-inventory"');
    expect(ui).toContain("const [page,setPage]=useState(1)");
    expect(ui).toContain("Math.ceil(displayed.length/pageSize)");
    expect(ui).toContain("ก่อนหน้า");
    expect(ui).toContain("ถัดไป");
    expect(ui).toContain("สร้างสินค้าหลายรายการ");
    expect(ui).toContain("กรอกเอง");
    expect(ui).toContain('role="dialog"');
    expect(ui).toContain('setBulk(r=>[...r,{...blank(),kind:tab}])');
    expect(ui).toContain('"PATCH":"POST"');
    expect(ui).toContain("Soft Delete");
    expect(ui).toContain("สต๊อกกรอบแว่น");
    expect(ui).toContain("สต๊อกเลนส์");
    expect(ui).toContain("ดูรหัส");
    expect(ui).toContain("จำนวนคงเหลือ");
    expect(ui).toContain("lens_sph");
    expect(ui).toContain("frame_size");
    expect(ui).toContain("เลือกสาขา");
    expect(ui).toContain("สินค้าขายดี");
    expect(ui).toContain("targetBranchId");
    expect(ui).toContain("branch_id:destination");
  });
  it("best sellers only include paid completed sales from a scoped branch",()=>{
    const report=text("app/api/pos/optical/best-sellers/route.ts");
    expect(report).toContain('verifyOpticalBranch');
    expect(report).toContain('.eq("status","completed")');
    expect(report).toContain('"order_items"');
    expect(report).toContain('period_days:30');
    expect(report).toContain("sampled:truncated");
  });
  it("requires IT-approved CUSTOM Optical and owner/manager on every write",()=>{
    const api=text("app/api/pos/optical/catalog/route.ts");
    expect(api).toContain("getCustomPosStockUiMode");
    expect(api).toContain("requireOpticalRetailEntitlement");
    expect(api).toContain('role!=="owner"&&role!=="manager"');
    expect(api).toContain('requirePermission(scope,"inventory:view")');
    expect(api).toContain('requireTenantFeature(scope.session.tenant_id,"stock_management"');
    expect(api).toContain('eq("branch_id",ctx.branchId)');
    expect(api).toContain('verifyOpticalBranch');
    expect(api).toContain("case-sensitive");
    expect(api).toContain('stock_deduction_mode:"unit_only"');
    expect(api).toContain('optical_catalog_sku_duplicate');
    expect(api).toContain("optical_catalog_in_use");
    expect(api).toContain('delete_reason:"optical_catalog_soft_delete"');
    expect(api).not.toContain('from("stock_movements")');
    expect(api).not.toContain('from("payments")');
  });
});

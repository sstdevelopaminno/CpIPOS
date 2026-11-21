import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("CUSTOM Recycling material removal - single and all items",()=>{
  const api=read("src/app/api/pos/recycling/catalog/route.ts");
  const ui=read("src/components/pos/recycling-stock-workspace.tsx");
  const normal=read("src/app/api/pos/products/route.ts");
  const stockPage=read("src/app/preview/pos/recycling/stock/page.tsx");
  const catalogService=read("src/lib/server/recycling-pos-service.ts");

  it("offers individual and all-material removal only for a branch manager",()=>{
    expect(ui).toContain("data-testid=\"recycling-delete-all\"");
    expect(ui).toContain("recycling-delete-item-");
    expect(ui).toContain("aria-label={\"ลบวัสดุ \"+item.name}");
    expect(ui).toContain("canManage && items.length>0");
    expect(ui).toContain("canManage && <td");
    expect(ui).toContain('requestDelete("all",event.currentTarget)');
    expect(ui).toContain("requestDelete(item,event.currentTarget)");
    expect(stockPage).toContain("canManage={branch.canManage}");
    expect(api).toContain('role !== "owner" && role !== "manager"');
    expect(api).toContain("isAuthorizedRecyclingTenant(tenantId)");
    expect(api).toContain("getRecyclingStockBranches(scope)");
    expect(api).toContain("requireRecyclingStockBranch(requestedBranchId, branches, true)");
    expect(api).toContain('requirePosApiFeature({ tenantId, branchId }, "stock_management")');
  });

  it("requires confirmation dialogs and typed text for bulk deletion",()=>{
    expect(ui).toContain('data-testid="recycling-material-delete-confirm"');
    expect(ui).toContain('role="alertdialog" aria-modal="true"');
    expect(ui).toContain('data-testid="recycling-material-delete-overlay"');
    expect(ui).toContain('onClick={cancelDelete}');
    expect(ui).toContain('event.key==="Escape"');
    expect(ui).toContain('method:"DELETE"');
    expect(ui).toContain('branch_id:branchId');
    expect(ui).toContain("expected_count:items.length");
    expect(ui).toContain('confirmation:"ลบทั้งหมด"');
    expect(ui).toContain('confirmation:"ลบรายการนี้"');
    expect(ui).toContain('deleteConfirmation.trim()!=="ลบทั้งหมด"');
    expect(api).toContain('body.confirmation !== "ลบทั้งหมด"');
    expect(api).toContain('body.confirmation !== "ลบรายการนี้"');
    expect(api).toContain('materials.length !== body.expected_count');
  });

  it("soft-deletes exclusively branch-scoped Recycling materials preserving product history",()=>{
    expect(api).toContain('export async function DELETE(request: Request)');
    expect(api).toContain('.eq("tenant_id", tenantId).eq("branch_id", branchId)');
    expect(api).toContain('.contains("metadata", {business_mode:"recycling"})');
    expect(api).toContain('.eq("is_active", true).is("deleted_at", null)');
    expect(api).toContain('update({is_active:false,deleted_at:deletedAt})');
    expect(api).toContain('.contains("metadata",{business_mode:"recycling"})');
    expect(api).toContain('.in("id",ids)');
    expect(api).toContain('from("recycling_stock_balances")');
    expect(api).toContain('Number(row.quantity_base) !== 0');
    expect(api).toContain("recycling_material_has_stock");
    expect(api).toContain("recycling_stock_verification_failed");
    expect(api).toContain("recycling_material_bulk_limit");
    expect(api).toContain("appendAuditLog({");
    expect(api).not.toContain('from("products").delete()');
    expect(catalogService).toContain('.eq("is_active", true).is("deleted_at", null)');
    expect(normal).not.toContain("recycling_materials_soft_deleted_bulk");
  });
});

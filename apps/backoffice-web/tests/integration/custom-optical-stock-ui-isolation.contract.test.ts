import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const file=(name:string)=>readFileSync(resolve(process.cwd(),"src",name),"utf8");

describe("CUSTOM inventory UI is isolated from food POS",()=>{
  const shared=file("app/preview/pos/stock/page.tsx");
  const policy=file("lib/server/custom-stock-ui-policy.ts");
  const specialized=file("app/preview/pos/stock/custom/page.tsx");

  it("preserves original ingredient/recipe stock and food pages",()=>{
    expect(shared).toContain("<StockProductsTable");
    expect(shared).toContain("ingredientList={ingredientList}");
    expect(shared).toContain('if(customStockMode==="optical"||customStockMode==="retail")');
    expect(shared).toContain('customStockMode==="mixed"');
  });
  it("requires active IT-approved CUSTOM stock mode instead of a package-only grant",()=>{
    expect(policy).toContain('if(effective.length!==1)return "legacy"');
    expect(policy).toContain('String(plan?.code??"").toLowerCase()!=="custom"');
  });
  it("does not allow Optical stock screen without menu, inventory and branch permissions",()=>{
    expect(specialized).toContain('assertPosMenuPageAllowed(session.session.tenant_id,"/preview/pos/stock")');
    expect(specialized).toContain('requirePosPagePermission("inventory:view")');
    expect(specialized).toContain('if(mode!=="optical"&&mode!=="retail"&&mode!=="mixed")notFound()');
    expect(specialized).toContain('.eq("tenant_id",tenantId).eq("branch_id",branchId)');
  });
  it("has no inventory or payment writers; legacy product stock is explicitly unverified",()=>{
    expect(specialized).not.toContain('insert(');
    expect(specialized).not.toContain('update(');
    expect(specialized).not.toContain('delete(');
    expect(specialized).not.toContain('from("stock_movements")');
    expect(specialized).toContain("recipeAttached");
    expect(specialized).toContain("Optical");
    expect(specialized).toContain("ยังผูกสต๊อกสูตรเดิม");
  });
});

import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
describe("Finance-only Recycling accountant entry",()=>{
 it("uses the independent Finance identity and preserves the existing dashboard",()=>{
  const page=read("app/finance/page.tsx");
  expect(page).toContain('await requireAccountantPage("main.finance")');
  expect(page).toContain("isAuthorizedRecyclingTenant(identity.tenantId)");
  expect(page).toContain("<RecyclingFinanceDashboard actor=\"accountant\"/>");
  expect(page).toContain('<FinanceSalesDashboard actor="accountant" />');
 });
 it("restricts the branch selected in the VAT setup endpoint to Finance grants and menu policy",()=>{
  const route=read("app/api/pos/recycling/vat/setup/route.ts");
  expect(route).toContain("await requireFinanceSession()");
  expect(route).toContain("identity.branchIds.includes(branchId)");
  expect(route).toContain('isAccountantMenuVisible("finance.tax_reports",overrides)');
  expect(route).toContain("tenant_id:identity.tenantId,branch_id:branchId,user_id:identity.userId");
  expect(route).toContain('scope.session.role!=="accountant"');
 });
 it("queries only authorized tenant/branches and does not invent aggregate totals",()=>{
  const ui=read("components/finance/recycling-accountant-overview.tsx");
  expect(ui.match(/\.eq\("tenant_id",identity\.tenantId\)/g)?.length).toBe(3);
  expect(ui.match(/\.in\("branch_id",identity\.branchIds\)/g)?.length).toBe(2);
  expect(ui).toContain('.is("finance_document_id",null)');
  expect(ui).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
 });
});

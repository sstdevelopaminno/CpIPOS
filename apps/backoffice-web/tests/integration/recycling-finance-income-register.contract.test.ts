import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
describe("Recycling income register",()=>{
 it("selects the Recycling workspace only for eligible tenants",()=>{
  const page=read("app/finance/[module]/page.tsx");
  expect(page).toContain('slug==="income"&&await isAuthorizedRecyclingTenant(identity.tenantId)');
  expect(page).toContain("<RecyclingFinanceIncomeWorkspace/>");
  expect(page).toContain("<FinanceIncomeWorkspace />");
 });
 it("reads only authorized posted sales, never purchases or ordinary POS orders",()=>{
  const route=read("app/api/finance/recycling-income/route.ts");
  expect(route).toContain('await requireFinanceSession()');
  expect(route).toContain('isAccountantMenuVisible("finance.income"');
  expect(route).toContain('identity.branchIds.includes(branch)');
  expect(route).toContain('.eq("tenant_id",identity.tenantId)');
  expect(route).toContain('.eq("direction","sell").eq("status","posted")');
  expect(route).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
  expect(route).toContain('["cash","bank_transfer"].includes(row.settlement)');
 });
 it("uses separate existing manual income workflow and labels page totals",()=>{
  const ui=read("components/finance/recycling-finance-income-workspace.tsx");
  expect(ui).toContain("<FinanceOtherIncomeRegister recycling/>");
  expect(ui).toContain("รวมเฉพาะรายการในหน้านี้");
 });
});

import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
describe("Recycling Finance tax register",()=>{
 it("uses a separate Recycling register and a compact VAT popup",()=>{
  expect(read("app/finance/[module]/page.tsx")).toContain("<RecyclingFinanceTaxRegister/>");
  expect(read("components/finance/recycling-finance-vat-workspace.tsx")).toContain("<RecyclingVatSetup compact");
  expect(read("components/pos/recycling-vat-setup.tsx")).toContain("<FinanceDialog open={open}");
 });
 it("requires Finance identity and scopes both tax lists and immutable preview",()=>{
  const auth=read("lib/server/recycling-finance-tax-identity.ts");
  expect(auth).toContain('isAccountantMenuVisible("finance.tax_reports"');
  expect(auth).toContain("await requireFinanceSession()");
  const route=read("app/api/finance/recycling-tax/route.ts");
  expect(route).toContain('from("recycling_tax_invoices")');
  expect(route).toContain('.eq("direction","sell").eq("status","posted").eq("tax_state","vat_recorded")');
  expect(route).toContain("identity.branchIds.includes(branch)");
  expect(route.match(/\.eq\("tenant_id",identity\.tenantId\)/g)?.length).toBe(3);
  const preview=read("app/api/finance/recycling-tax/[id]/route.ts");
  expect(preview).toContain('.in("branch_id",identity.branchIds)');
  expect(preview).toContain('.eq("status","issued")');
  expect(preview).toContain("renderRecyclingTaxInvoiceHtml");
  expect(preview).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
 });
 it("checks the configured tax rule and same-origin mutations",()=>{
  const route=read("app/api/pos/recycling/vat/setup/route.ts");
  expect(route).toContain('request.headers.get("origin")');
  expect(route).toContain('active[0].mode==="add_to_bill"');
  expect(route).toContain("validVatRule(tax.data.settings)");
 });
});

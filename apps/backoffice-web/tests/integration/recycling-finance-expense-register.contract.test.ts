import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
describe("Recycling expense register and voucher",()=>{
 it("isolates purchases and keeps ordinary POS expense workspace",()=>{
  const route=read("app/api/finance/recycling-expenses/route.ts");
  expect(route).toContain('isAccountantMenuVisible("finance.expenses"');
  expect(route).toContain('identity.branchIds.includes(branch)');
  expect(route).toContain('.eq("direction","buy").eq("status","posted")');
  expect(route).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
  const page=read("app/finance/[module]/page.tsx");
  expect(page).toContain("<RecyclingFinanceExpenseWorkspace/>");
  expect(page).toContain('<FinanceAccountingRegister module="expenses" />');
 });
 it("prints only approved issued expense vouchers using existing accounting identity",()=>{
  const route=read("app/api/finance/expense-voucher/[id]/route.ts");
  expect(route).toContain('accountingIdentity("finance.expenses")');
  expect(route).toContain('d.kind!=="expense_voucher"||d.status!=="issued"||!d.approvedBy');
  expect(route).toContain('size!=="A4"&&size!=="A5"');
  expect(route).toContain('snapshot.data.version!==d.version');
  expect(route).toContain('escape(l.description)');
  expect(route).toContain("window.print()");
  expect(route).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
 });
});

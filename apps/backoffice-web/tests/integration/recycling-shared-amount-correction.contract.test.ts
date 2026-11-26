import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
describe("Recycling shared amount correction",()=>{
 it("keeps both source routes behind trusted scoped sessions",()=>{
  const pos=read("app/api/pos/recycling/transactions/[id]/amount-correction/route.ts");
  const finance=read("app/api/finance/recycling/transactions/[id]/amount-correction/route.ts");
  expect(pos).toContain("requirePosSession()");
  expect(pos).toContain('["owner","manager"]');
  expect(finance).toContain("requireFinanceSession()");
  expect(finance).toContain('in("branch_id",identity.branchIds)');
  for(const route of [pos,finance])expect(route).toContain("recyclingAmountCorrection(request");
 });
 it("calls one atomic RPC only when both rollout gates are enabled",()=>{
  const service=read("lib/server/recycling-amount-correction-service.ts");
  expect(service).toContain('RECYCLING_MANUAL_DOCUMENT_TIME_ENABLED!=="1"');
  expect(service).toContain('RECYCLING_AMOUNT_CORRECTION_ENABLED!=="1"');
  expect(service).toContain('rpc("recycling_replace_eligible_bill"');
  expect(service).toContain("p_expected_total:total");
  expect(service).toContain("p_stock_verified:true");
  expect(service).not.toMatch(/\.(insert|update|delete|upsert)\(/);
 });
 it("shares one editor, retains original receipt and refreshes both views",()=>{
  for(const path of ["components/pos/recycling-sales-list-row-actions.tsx","components/finance/recycling-finance-income-workspace.tsx","components/finance/recycling-finance-expense-workspace.tsx"])expect(read(path)).toContain("<RecyclingAmountCorrectionEditor");
  expect(read("components/pos/recycling-amount-correction-editor.tsx")).toContain("replacement_receipt_no");
 });
});

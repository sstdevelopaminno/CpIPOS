import {describe,expect,it} from "vitest";
import {sumRecyclingReportMoney,type MoneyRecyclingRow} from "@/lib/recycling-report-calculation";
const row=(direction:MoneyRecyclingRow["direction"],settlement:MoneyRecyclingRow["settlement"],amount:number,status:MoneyRecyclingRow["status"]="posted"):MoneyRecyclingRow=>({
 direction,settlement,total_minor:amount,cogs_minor:direction==="sell"?Math.trunc(amount/2):0,status
});
describe("CUSTOM Recycling report finance isolation",()=>{
 it("keeps cash buying separate from sales (not negative revenue)",()=>{
  const x=sumRecyclingReportMoney([row("buy","cash",12000),row("sell","cash",20000)]);
  expect(x).toMatchObject({buyMinor:12000,sellMinor:20000,cashInMinor:20000,cashOutMinor:12000,buyCount:1,sellCount:1});
  expect(x.cogsMinor).toBe(10000);
 });
 it("does not record bank transfers or credit as physical cash",()=>{
  const x=sumRecyclingReportMoney([row("buy","bank_transfer",500),row("sell","bank_transfer",800),row("buy","credit",300),row("sell","credit",400)]);
  expect(x).toMatchObject({cashInMinor:0,cashOutMinor:0,transferOutMinor:500,transferInMinor:800,creditOutMinor:300,creditInMinor:400});
 });
 it("voided buys/sales are visible in audit count but not totals",()=>{
  const x=sumRecyclingReportMoney([row("buy","cash",999,"voided"),row("sell","cash",888,"voided")]);
  expect(x).toMatchObject({voidCount:2,buyCount:0,sellCount:0,buyMinor:0,sellMinor:0,cashInMinor:0,cashOutMinor:0});
 });
 it("rejects unsafe values instead of silently rounding money",()=>{
  expect(()=>sumRecyclingReportMoney([row("sell","cash",Number.MAX_SAFE_INTEGER+1)])).toThrow("recycling_report_unsafe_amount");
  expect(()=>sumRecyclingReportMoney([row("sell","cash",-10)])).toThrow("recycling_report_unsafe_amount");
 });
});

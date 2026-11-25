import {describe,it,expect} from "vitest";
import {periodDates,validateOverviewDates,summarizeRecyclingFinance,summarizeRecyclingCapital,type RecyclingFinanceTransaction,type RecyclingFinanceShift} from "../../src/lib/recycling-finance-overview";
const tx=(id:string,direction:string,settlement:string,total:number,base:number,cogs:number):RecyclingFinanceTransaction=>({id,branch_id:"b",shift_id:"s2",direction,settlement,total_minor:total,base_minor:base,vat_minor:total-base,cogs_minor:cogs});
describe("Recycling finance overview",()=>{
 it("separates purchase cash out, VAT-exclusive revenue, COGS and bank movement",()=>{
  const r=summarizeRecyclingFinance([tx("a","buy","cash",20000,20000,0),tx("b","sell","bank_transfer",32100,30000,15000),tx("c","sell","credit",10000,10000,5000)]);
  expect(r).toMatchObject({buy:20000,sell:42100,revenue:40000,cogs:20000,profit:20000,loss:0,cashNet:-20000,bankNet:32100,vat:2100,creditSell:10000});
 });
 it("does not add repeated float across shifts",()=>{
  const s=(id:string,day:string,opening:number,actual:number|null):RecyclingFinanceShift=>({id,branch_id:"b",opened_at:day+"T01:00:00Z",closed_at:actual===null?null:day+"T10:00:00Z",opening_cash:opening,actual_cash:actual,expected_cash:actual,metadata:{}});
  expect(summarizeRecyclingCapital(["b"],[s("s1","2026-11-24",4000,3800),s("s2","2026-11-25",3800,null)],[],[tx("a","buy","cash",20000,20000,0)],"2026-11-23T17:00:00Z","2026-11-26T00:00:00Z")).toEqual({opening:400000,remaining:360000,estimated:true});
  expect(summarizeRecyclingCapital(["b"],[],[],[],"2026-11-23T17:00:00Z","2026-11-26T00:00:00Z")).toEqual({opening:null,remaining:null,estimated:true});
 });
 it("supports day month year and Bangkok date ranges",()=>{
  expect(periodDates("year","2026-11-25","2026-11-26")).toEqual({from:"2026-01-01",to:"2026-11-26"});
  expect(periodDates("month","2026-02-10","2026-11-26")).toEqual({from:"2026-02-01",to:"2026-02-28"});
  expect(validateOverviewDates("2026-11-25","2026-11-25","2026-11-26")).toEqual({start:"2026-11-24T17:00:00.000Z",end:"2026-11-25T17:00:00.000Z"});
  expect(()=>validateOverviewDates("2026-02-30","2026-03-01","2026-11-26")).toThrow();
 });
});

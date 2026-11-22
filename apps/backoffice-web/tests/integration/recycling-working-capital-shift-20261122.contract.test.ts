import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
import { recyclingExpectedDrawerMinor } from "../../src/lib/recycling-working-capital";
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const ui=read("src/components/pos/recycling-shift-control.tsx");
const history=read("src/components/pos/recycling-shift-history-page-content.tsx");
const open=read("src/app/api/pos/shifts/open/route.ts");
const summary=read("src/app/api/pos/recycling/funding/summary/route.ts");
const current=read("src/app/api/pos/recycling/shifts/current/route.ts");
const tx=read("src/app/api/pos/recycling/transactions/route.ts");

describe("Recycling working capital cash reconciliation",()=>{
 it("tracks outgoing cash purchases and incoming *cash* factory sales",()=>{
   expect(recyclingExpectedDrawerMinor({openingMinor:1_000_000,cashOutMinor:600_000,cashInMinor:0})).toBe(400_000);
   expect(recyclingExpectedDrawerMinor({openingMinor:1_000_000,cashOutMinor:600_000,cashInMinor:2_000_000})).toBe(2_400_000);
   expect(recyclingExpectedDrawerMinor({openingMinor:0,cashOutMinor:0,cashInMinor:0})).toBe(0);
 });
 it("refuses invented opening balances, negative drawer balances and unsafe arithmetic",()=>{
   expect(recyclingExpectedDrawerMinor({openingMinor:null,cashOutMinor:0,cashInMinor:100})).toBeNull();
   expect(recyclingExpectedDrawerMinor({openingMinor:71_00,cashOutMinor:72_00,cashInMinor:0})).toBeNull();
   expect(recyclingExpectedDrawerMinor({openingMinor:-1,cashOutMinor:0,cashInMinor:0})).toBeNull();
   expect(recyclingExpectedDrawerMinor({openingMinor:Number.MAX_SAFE_INTEGER,cashOutMinor:0,cashInMinor:1})).toBeNull();
   expect(recyclingExpectedDrawerMinor({openingMinor:100,cashOutMinor:-1,cashInMinor:0})).toBeNull();
 });
 it("separates posted finance cash GL 1100 from bank 1110, branch tenant scoped and read only",()=>{
   expect(summary).toContain('code:"1100"');
   expect(summary).toContain('code:"1110"');
   expect(summary).toContain('.from("finance_accounting_journal_lines")');
   expect(summary).toContain('.eq("tenant_id",tenantId).eq("branch_id",branchId)');
   expect(summary).toContain('financeStatus="unposted"');
   expect(summary).toContain('financeStatus="unavailable"');
   expect(summary).toContain('const manager=["owner","manager","accountant"].includes(role)');
   expect(summary).toContain('recyclingExpectedDrawerMinor(');
   expect(summary).not.toContain('.insert(');
   expect(summary).not.toContain('.update(');
   expect(summary).not.toContain('.rpc("recycling_post_transaction"');
 });
 it("takes opening capital from physically counted cash and captures only an audit reference",()=>{
   expect(ui).toContain('ที่มาของทุนรับซื้อ');
   expect(ui).toContain('เงินทุนสดที่ได้รับและนับจริง (บาท)');
   expect(ui).toContain('cash_count_confirmed:cashCountConfirmed');
   expect(ui).toContain('fund_source:fundSource');
   expect(ui).toContain('ต้องให้ฝ่ายบัญชีกระทบยอด');
   expect(open).toContain('recycling_fund_source:fundSource');
   expect(open).toContain('recycling_fund_reference:fundReference||null');
   expect(open).toContain('reference_only_pending_accounting_reconciliation');
   expect(open).toContain('if(recyclingRequested){');
   expect(open).toContain('body?.cash_count_confirmed!==true');
   expect(current).toContain('fund_source:typeof');
 });
 it("never uses unverified transfer or credit to fund the cash drawer",()=>{
   expect(tx).toContain('raw.settlement === "bank_transfer"');
   expect(tx).toContain('recycling_cash_drawer_insufficient');
   expect(tx).toContain('recycling_stock_insufficient');
   expect(tx).toContain('"recycling_post_transaction_vat" : "recycling_post_transaction"');
    expect(tx).toContain('RECYCLING_VAT_WRITES_ENABLED==="1"');
   expect(ui).toContain('เงินฝากธนาคาร (1110)');
   expect(ui).toContain('ไม่ใช่เงินสดที่จ่ายซื้อได้ทันที');
   expect(history).toContain('ทุนเงินสดเปิดกะ');
   expect(history).toContain('รับซื้อ · เงินสดจ่าย');
   expect(history).toContain('ขายออก · เงินสดรับ');
 });
});

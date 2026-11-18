import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyFinanceDocumentAction, assertBalancedFinanceJournal,
  currencyToMinor, financeAgingAsOf, financePostingKey } from "../../src/lib/finance-accounting-core";

const file=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const sql=file("../../supabase/migrations/20261118164343_finance_accounting_v2_documents_journal.sql");
const service=file("src/lib/server/finance-accounting-workflow.ts");
const api=file("src/app/api/finance/accounting/route.ts");
const ui=file("src/components/finance/finance-accounting-register.tsx");
const sales=file("src/components/pos/pos-sales-module.tsx");
const history=file("src/components/pos-preview/pos-receipts-workspace.tsx");
const receiptRoute=file("src/app/preview/pos/receipts/page.tsx");

describe("Finance accounting v2 core and POS cash receipt contracts",()=>{
  it("keeps finance feature closed until server-side activation with a valid session",()=>{
    expect(service).toContain('process.env.FINANCE_ACCOUNTING_V2_ENABLED !== "true"');
    expect(service).toContain("requireFinanceSession()");
    expect(service).toContain("isAccountantMenuVisible(menuKey,overrides)");
    expect(service).toContain("validBranch(identity,body.branchId)");
    expect(api).toContain('request.headers.get("origin")!==url.origin');
    expect(api).toContain('startsWith("application/json")');
    expect(service).not.toContain('.from("orders").insert');
  });
  it("has atomic DB locking, approval separation, evidence and idempotency restrictions",()=>{
    for(const required of [
      'FOR UPDATE;', 'finance_accounting_self_approval_forbidden',
      'finance_accounting_version_conflict','finance_accounting_period_locked',
      'finance_accounting_overallocation','finance_accounting_source_flow_invalid',
      'finance_accounting_payment_evidence_required',
      'UNIQUE(tenant_id,branch_id,posting_key)',
      'UNIQUE(tenant_id,branch_id,request_key)',
      'debit_total_minor=credit_total_minor',
      'finance_accounting_append_only',
      'REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',
      'finance_accounting_create_document','finance_accounting_post_document',
      'v_source.currency<>p_currency',
      'pg_catalog.round('
    ])expect(sql).toContain(required);
    expect(service).toContain("p_evidence_ref:evidenceRef,p_evidence_type:evidenceType");
    expect(service).toContain('accountingJournals(identity');
    expect(service).toContain('.lte("issued_at",endBangkokIso)');
  });
  it("links accounting sales/purchase documents and records evidence for cash transactions",()=>{
    for(const required of [
      'sales_order:["sales_quote"]','delivery_note:["sales_order"]',
      'sales_invoice:["delivery_note","sales_order"]',
      'supplier_bill:["goods_receipt","purchase_order"]',
      'receipt_voucher:["sales_invoice"]','payment_voucher:["supplier_bill"]',
      'sourceDocumentId:canLinkSource&&sourceDocumentId?',
      'evidenceNeeded=settlement||kind==="expense_voucher"||kind==="bank_transfer"',
      'สมุดรายวันที่โพสต์แล้ว','หลักฐานการรับ/จ่ายเงิน'
    ])expect(ui).toContain(required);
  });
  it("links the POS sale completion action to its existing guarded history route",()=>{
    expect(receiptRoute).toContain("requirePosSession()");
    expect(receiptRoute).toContain('"/preview/pos/receipts"');
    expect(sales).toContain('const url = "/preview/pos/receipts?officeBillNo="');
    expect(sales).not.toContain('/preview/pos/more/receipts?officeBillNo=');
    expect(sales).toContain('if (!receiptSession || !receiptSaved) return');
    expect(history).toContain('officeBillNo');
    expect(history).toContain('paper: "A4"');
    expect(history).toContain('manager_pin: reprint.pin');
    expect(history).toContain('mode !== "office_browser_authorized"');
  });
  it("preserves double-entry math and aging calculations",()=>{
    expect(currencyToMinor(5.25,"THB")).toBe(525);
    expect(()=>assertBalancedFinanceJournal([
      {accountId:"a",currency:"THB",debitMinor:100,creditMinor:0},
      {accountId:"b",currency:"THB",debitMinor:0,creditMinor:101}
    ])).toThrow("finance_journal_unbalanced");
    expect(financePostingKey({tenantId:"T",branchId:"B",sourceType:"order",sourceId:"S",event:"pos_paid_sale"}))
      .not.toBe(financePostingKey({tenantId:"T",branchId:"B",sourceType:"order",sourceId:"S2",event:"pos_paid_sale"}));
    const bins=financeAgingAsOf([
      {id:"i1",currency:"THB",dueDate:"2026-11-01",originalMinor:20000,appliedMinor:5000}
    ],"2026-11-18");
    expect(bins[0].days1to30Minor).toBe(15000);
    expect(()=>applyFinanceDocumentAction({status:"submitted",preparedBy:"u1",approvedBy:null,posted:false},"approve","u1"))
      .toThrow("finance_self_approval_forbidden");
  });
});

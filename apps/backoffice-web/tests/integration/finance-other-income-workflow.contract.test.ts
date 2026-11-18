import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = source("../../supabase/migrations/20261118133000_finance_accounting_v2_documents_journal.sql");
const page = source("src/app/finance/[module]/page.tsx");
const income = source("src/components/finance/finance-income-workspace.tsx");
const registry = source("src/components/finance/finance-other-income-register.tsx");
const service = source("src/lib/server/finance-other-income-service.ts");
const route = source("src/app/api/finance/accounting/other-income/route.ts");
const register = source("src/components/finance/finance-accounting-register.tsx");
const banking = source("src/components/finance/finance-banking-workspace.tsx");

describe("Accountant independent other-income workflow and professional module UI", () => {
  it("removes placeholder workflow cards in favor of actual document registers", () => {
    expect(page).toContain("<FinanceIncomeWorkspace />");
    expect(page).toContain('<FinanceAccountingRegister module="expenses" />');
    expect(page).toContain('<FinanceAccountingRegister module="sales-receivables" />');
    expect(page).toContain('<FinanceAccountingRegister module="purchases-payables" />');
    expect(page).toContain("<FinanceBankingWorkspace />");
    expect(page).toContain('<FinanceAccountingRegister module="ledger" />');
    expect(page).toContain('<FinanceDocumentWorkspace kind="tax" />');
    expect(page).not.toContain("WorkflowPanel");
    expect(page).not.toContain("ยังไม่เปิดบันทึกจริง");
  });

  it("gives Income two distinct data sources, each with its own table and permissions", () => {
    expect(income).toContain('tab === "pos"');
    expect(income).toContain('tab === "other"');
    expect(income).toContain('FinanceSalesDashboard actor="accountant" initialTab="sales" showTabs={false}');
    expect(income).toContain("<FinanceOtherIncomeRegister />");
    expect(registry).toContain("ทะเบียนรายรับอื่น ๆ");
    expect(registry).toContain("รายรับที่บันทึกจากแหล่งอื่น ไม่เชื่อมโยงหรือสร้างยอดขาย POS");
    expect(registry).toContain("<FinanceDialog open={createOpen}");
    expect(registry).toContain("<FinanceDialog open={Boolean(selected)}");
    expect(registry).toContain("setCreateOpen(false)");
    expect(registry).toContain('action: "create"');
    expect(registry).toContain('action: "transition"');
    expect(registry).toContain("รายการ"); 
    expect(registry).toContain("ราคา/หน่วย");
    expect(registry).toContain("จำนวน");
    expect(registry).toContain("ช่องทางรับชำระ");
    expect(registry).toContain("หมายเหตุ");
    expect(registry).toContain('return value?.trim() && value !== "-" ? value : "-"');
  });

  it("has server-only, concurrency-safe per-branch document numbering and idempotency", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.finance_accounting_number_series");
    expect(migration).toContain("PRIMARY KEY(tenant_id,branch_id,fiscal_year,series)");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.finance_accounting_create_other_income(");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("ON CONFLICT (tenant_id,branch_id,fiscal_year,series)");
    expect(migration).toContain("RETURNING next_no-1 INTO v_seq");
    expect(migration).toContain("'OIN-'||v_year::text");
    expect(migration).toContain("finance_accounting_idempotency_conflict");
    expect(migration).toContain("document_kind<>'other_income'");
    expect(migration).toContain("status','draft'");
    expect(migration).toContain("finance_accounting_document_events");
    expect(migration).toContain("'manual_other_income'");
    expect(migration).toContain("finance_accounting_post_document");
    expect(migration).toContain("v_doc.document_kind='other_income'");
    expect(migration).not.toContain("INSERT INTO public.orders");
    expect(migration).not.toContain("INSERT INTO public.payments");
  });

  it("keeps manually entered income tenant/branch scoped and off until approved", () => {
    expect(service).toContain('import "server-only"');
    expect(service).toContain('eq("tenant_id", identity.tenantId)');
    expect(service).toContain('identity.branchIds.includes(input)');
    expect(service).toContain('.eq("document_kind", "other_income")');
    expect(service).toContain("currencyToMinor");
    expect(service).toContain('finance_accounting_create_other_income');
    expect(service).toContain('p_request: request');
    expect(route).toContain('accountingIdentity("finance.income")');
    expect(route).toContain('request.headers.get("origin") !== url.origin');
    expect(route).toContain("createOtherIncome(identity, body)");
    expect(route).toContain("accountingTransition(identity, {");
    expect(route).toContain('Cache-Control');
    expect(registry).toContain("เป็นแบบร่าง รอการอนุมัติ");
  });

  it("uses accessible shared POP UP dialogs for create, review, chart accounts and journals", () => {
    expect(register).toContain('<FinanceDialog open={createOpen}');
    expect(register).toContain('{selected&&<FinanceDialog open={Boolean(selected)}');
    expect(register).toContain('<FinanceDialog open={accountOpen}');
    expect(register).toContain('<FinanceDialog open={Boolean(journalOpenId)}');
    expect(register).not.toContain('role="presentation" className="fixed inset-0 z-[100]');
    expect(register).toContain('view=document_detail&documentId=');
    expect(register).toContain('view=journal_detail&journalId=');
    expect(register).toContain('สมุดรายวันที่โพสต์แล้ว');
    expect(register).toContain('ยอดค้างชำระ');
  });

  it("posts approved other-income documents only by explicit balanced GL choice", () => {
    expect(registry).toContain('action: "post_document"');
    expect(registry).toContain("debitAccountId: debit");
    expect(registry).toContain("creditAccountId: credit");
    expect(registry).toContain('item.type === "asset"');
    expect(registry).toContain('item.type === "income"');
    expect(registry).toContain("setPostAllowed(false)");
    expect(registry).toContain('selected.status === "issued" && !selected.postedJournalId && postAllowed');
    expect(migration).toContain("v_doc.document_kind='other_income'");
    expect(migration).toContain("finance_accounting_posting_not_approved");
  });

  it("keeps bank transfers separate from POS payment-mismatch and real statements", () => {
    expect(banking).toContain('<FinanceAccountingRegister module="banking" />');
    expect(banking).toContain('FinanceSalesDashboard actor="accountant" initialTab="reconcile" showTabs={false}');
    expect(banking).toContain("ยังไม่ถือเป็นการกระทบยอด Bank Statement");
    expect(migration).toContain("finance_accounting_bank_transfer_evidence_required");
    expect(migration).toContain("v_doc.document_kind='bank_transfer'");
    expect(register).toContain('banking:[{value:"bank_transfer"');
  });
});

import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { currencyToMinor, type FinanceCurrency } from "@/lib/finance-accounting-core";
import { FinanceAccountingError } from "@/lib/server/finance-accounting-workflow";
import type { FinanceIdentity } from "@/lib/server/finance-session";

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const currencies: FinanceCurrency[] = ["THB", "LAK", "USD"];
const methods = ["cash", "transfer", "card", "cheque", "other"] as const;

function dbError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST202")
    throw new FinanceAccountingError("finance_accounting_schema_unavailable", 503);
  if (error.code === "42501")
    throw new FinanceAccountingError("finance_accounting_forbidden", 403);
  if (error.code === "23505")
    throw new FinanceAccountingError("finance_accounting_duplicate", 409);
  if (error.message?.startsWith("finance_accounting_"))
    throw new FinanceAccountingError(error.message.split("\n")[0].slice(0, 110), 422);
  console.error("[finance/other-income] database unavailable", error.code ?? "unknown");
  throw new FinanceAccountingError("finance_accounting_database_unavailable", 503);
}
function branchScope(identity: FinanceIdentity, input: unknown): string | null {
  if (input == null || input === "") return null;
  if (typeof input !== "string" || !idPattern.test(input) ||
      !identity.branchIds.includes(input))
    throw new FinanceAccountingError("finance_accounting_branch_forbidden", 403);
  return input;
}
function requiredText(value: unknown, max: number, code: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new FinanceAccountingError(code, 422);
  return value.trim();
}
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max)
    throw new FinanceAccountingError("finance_accounting_optional_text_invalid", 422);
  return value.trim() || null;
}

export type OtherIncomeRow = {
  id: string;
  branchId: string;
  number: string;
  date: string;
  createdAt: string;
  description: string | null;
  quantity: number;
  unitMinor: number;
  currency: FinanceCurrency;
  paymentMethod: string;
  amountMinor: number;
  note: string | null;
  counterparty: string | null;
  status: string;
  version: number;
  postedJournalId: string | null;
  preparedBy: string;
  approvedBy: string | null;
};

export async function listOtherIncome(
  identity: FinanceIdentity, branchId: string | null, dates?: {from:string|null;to:string|null}
): Promise<{ rows: OtherIncomeRow[]; hasMore: boolean }> {
  const branch = branchScope(identity, branchId);
  const db = getPrimarySupabaseServiceClient();
  let query = db.from("finance_accounting_documents")
    .select("id,branch_id,document_no,document_date,created_at,payment_method,remarks,counterparty_name,status,version,currency,amount_minor,posted_journal_id,prepared_by,approved_by")
    .eq("tenant_id", identity.tenantId)
    .in("branch_id", branch ? [branch] : identity.branchIds)
    .eq("document_kind", "other_income")
    .order("created_at", { ascending: false }).order("id",{ascending:false}).limit(101);
  const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  const from=dates?.from,to=dates?.to;
  if((from&&!validDate(from))||(to&&!validDate(to))||(from&&to&&from>to))throw new FinanceAccountingError("finance_accounting_date_invalid",422);
  if(from)query=query.gte("document_date",from);
  if(to)query=query.lte("document_date",to);
  const result = await query;
  dbError(result.error);
  const docs = (result.data ?? []).slice(0, 100);
  if (!docs.length) return { rows: [], hasMore: false };
  const detail = await db.from("finance_accounting_document_lines")
    .select("document_id,description,quantity,unit_minor")
    .eq("tenant_id", identity.tenantId)
    .in("branch_id", branch ? [branch] : identity.branchIds)
    .in("document_id", docs.map(x => x.id))
    .eq("line_no", 1).limit(100);
  dbError(detail.error);
  const lines = new Map((detail.data ?? []).map(x => [x.document_id, x]));
  return {
    rows: docs.map(doc => {
      const line = lines.get(doc.id);
      // No row is materialized from a blank, inferred, or unsaved POS sale.
      if (!line) throw new FinanceAccountingError("finance_accounting_other_income_line_missing", 503);
      return {
        id: String(doc.id),
        branchId: String(doc.branch_id),
        number: String(doc.document_no),
        date: String(doc.document_date),
        createdAt: String(doc.created_at),
        description: String(line.description || "").trim() || null,
        quantity: Number(line.quantity),
        unitMinor: Number(line.unit_minor),
        currency: doc.currency as FinanceCurrency,
        paymentMethod: String(doc.payment_method ?? ""),
        amountMinor: Number(doc.amount_minor),
        note: doc.remarks ? String(doc.remarks) : null,
        counterparty: doc.counterparty_name === "-" ? null : String(doc.counterparty_name ?? ""),
        status: String(doc.status),
        version: Number(doc.version),
        postedJournalId: doc.posted_journal_id ? String(doc.posted_journal_id) : null,
        preparedBy: String(doc.prepared_by),
        approvedBy: doc.approved_by ? String(doc.approved_by) : null
      };
    }),
    hasMore: (result.data ?? []).length > 100
  };
}

export async function createOtherIncome(
  identity: FinanceIdentity, body: Record<string, unknown>
): Promise<{ id: string; number: string; status: string; amountMinor: number; created: boolean }> {
  const branch = branchScope(identity, body.branchId);
  if (!branch) throw new FinanceAccountingError("finance_accounting_branch_required", 422);
  const request = requiredText(body.requestKey, 36, "finance_accounting_request_key_invalid");
  if (!idPattern.test(request))
    throw new FinanceAccountingError("finance_accounting_request_key_invalid", 422);
  const currency = body.currency;
  if (!currencies.includes(currency as FinanceCurrency))
    throw new FinanceAccountingError("finance_accounting_currency_invalid", 422);
  const method = requiredText(body.paymentMethod, 20, "finance_accounting_payment_method_invalid");
  if (!methods.some(item => item === method))
    throw new FinanceAccountingError("finance_accounting_payment_method_invalid", 422);
  const quantity = body.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) ||
      quantity <= 0 || quantity > 999999 || Math.abs(Math.round(quantity * 1_000_000) - quantity * 1_000_000) > 0.000001)
    throw new FinanceAccountingError("finance_accounting_quantity_invalid", 422);
  const unitPrice = body.unitPrice;
  if (typeof unitPrice !== "number" || unitPrice <= 0)
    throw new FinanceAccountingError("finance_accounting_amount_invalid", 422);
  const unitMinor = currencyToMinor(unitPrice, currency as FinanceCurrency);
  if (!unitMinor || !Number.isSafeInteger(Math.round(quantity * unitMinor)))
    throw new FinanceAccountingError("finance_accounting_amount_invalid", 422);
  const date = requiredText(body.date, 10, "finance_accounting_date_invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new FinanceAccountingError("finance_accounting_date_invalid", 422);
  const payload = {
    p_tenant: identity.tenantId, p_branch: branch, p_actor: identity.userId,
    p_request: request, p_date: date, p_currency: currency,
    p_quantity: quantity, p_unit_minor: unitMinor, p_method: method,
    p_description: optionalText(body.description, 500),
    p_counterparty: optionalText(body.counterparty, 240),
    p_note: optionalText(body.note, 1000)
  };
  const result = await getPrimarySupabaseServiceClient()
    .rpc("finance_accounting_create_other_income", payload);
  dbError(result.error);
  if (!result.data?.id || !result.data?.number)
    throw new FinanceAccountingError("finance_accounting_create_unavailable", 503);
  return {
    id: String(result.data.id),
    number: String(result.data.number),
    status: String(result.data.status),
    amountMinor: Number(result.data.amountMinor),
    created: Boolean(result.data.created)
  };
}

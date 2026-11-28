import "server-only";
import { rwWarehouseUatAllowed } from "@/lib/retail-wholesale/warehouse-uat-policy";
import { getCustomPosStockUiMode } from "@/lib/server/custom-stock-ui-policy";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { requireFinanceSession, type FinanceIdentity } from "@/lib/server/finance-session";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { isAccountantMenuVisible } from "@/lib/accountant-menu-policy";
import { financeAgingAsOf, type FinanceAgingRecord,
  type FinanceCurrency, type FinanceDocumentKind } from "@/lib/finance-accounting-core";

export class FinanceAccountingError extends Error {
  constructor(public code: string, public status = 422) { super(code); }
}
export const financeAccountModule = (kind: string): string => {
  if (["sales_quote","sales_order","delivery_note","sales_invoice","receipt_voucher"].includes(kind))
    return "finance.sales_receivables";
  if (["purchase_request","purchase_order","goods_receipt","supplier_bill","payment_voucher"].includes(kind))
    return "finance.purchases_payables";
  if (kind === "inventory_transfer") return "finance.ledger";
  if (kind === "other_income") return "finance.income";
  if (kind === "bank_transfer") return "finance.banking";
  if (kind === "expense_voucher") return "finance.expenses";
  throw new FinanceAccountingError("finance_accounting_kind_invalid");
};
function failClosedDb(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "23505") throw new FinanceAccountingError("finance_accounting_duplicate", 409);
  if (error.code === "42501") throw new FinanceAccountingError("finance_accounting_forbidden", 403);
  if (error.message?.startsWith("finance_accounting_"))
    throw new FinanceAccountingError(error.message.split("\n")[0].slice(0,100), 409);
  // New DB schema is not present until independently reviewed and migrated.
  if (error.code === "42P01" || error.code === "PGRST202")
    throw new FinanceAccountingError("finance_accounting_schema_unavailable", 503);
  console.error("[finance-accounting] database operation failed", error.code ?? "unknown");
  throw new FinanceAccountingError("finance_accounting_database_unavailable", 503);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new FinanceAccountingError("finance_accounting_id_invalid");
  return v;
}
function clean(v: unknown, max: number): string {
  if (typeof v !== "string" || !v.trim() || v.trim().length>max)
    throw new FinanceAccountingError("finance_accounting_field_invalid");
  return v.trim();
}
function day(v: unknown, optional = false): string | null {
  if (optional && (v === "" || v == null)) return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0,10)!==v)
    throw new FinanceAccountingError("finance_accounting_date_invalid");
  return v;
}
function currency(v: unknown): FinanceCurrency {
  if (v !== "THB" && v !== "LAK" && v !== "USD")
    throw new FinanceAccountingError("finance_accounting_currency_invalid");
  return v;
}
function validMinor(v: unknown, zero=false): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < (zero ? 0 : 1) || v > 99999999999999)
    throw new FinanceAccountingError("finance_accounting_amount_invalid");
  return v;
}
async function authorize(identity: FinanceIdentity, menuKey: string) {
  const overrides = await getTenantPosMenuOverrides(identity.tenantId);
  if (!isAccountantMenuVisible(menuKey,overrides))
    throw new FinanceAccountingError("finance_accounting_menu_forbidden", 403);
}
export async function accountingIdentity(moduleKey: string): Promise<FinanceIdentity> {
  const identity=await requireFinanceSession();
  if (!identity) throw new FinanceAccountingError("finance_session_required",401);
  if (process.env.FINANCE_ACCOUNTING_V2_ENABLED !== "true")
    throw new FinanceAccountingError("finance_accounting_not_enabled",503);
  await authorize(identity,moduleKey);
  return identity;
}
function validBranch(identity: FinanceIdentity, value: unknown): string {
  const id=uuid(value);
  if (!identity.branchIds.includes(id))
    throw new FinanceAccountingError("finance_accounting_branch_forbidden",403);
  return id;
}
type DbDocument = { id: string; tenant_id: string; branch_id: string; document_kind: string;
  document_no: string; status: string; version: number; amount_minor: number;
  currency: FinanceCurrency; counterparty_name: string; document_date: string;
  due_date: string | null; prepared_by: string; approved_by: string | null;
  posted_journal_id: string | null; source_document_id: string | null; };
function mapDocument(d: DbDocument) {
  return { id:d.id, branchId:d.branch_id, kind:d.document_kind, number:d.document_no,
    status:d.status, version:d.version, amountMinor:Number(d.amount_minor),
    currency:d.currency, party:d.counterparty_name, date:d.document_date,
    dueDate:d.due_date, preparedBy:d.prepared_by, approvedBy:d.approved_by,
    postedJournalId:d.posted_journal_id, sourceDocumentId:d.source_document_id };
}
export async function getAccountingDocument(identity: FinanceIdentity,id: string) {
  const q=await getPrimarySupabaseServiceClient().from("finance_accounting_documents")
    .select("id,tenant_id,branch_id,document_kind,document_no,status,version,amount_minor,currency,counterparty_name,document_date,due_date,prepared_by,approved_by,posted_journal_id,source_document_id")
    .eq("tenant_id",identity.tenantId).in("branch_id",identity.branchIds)
    .eq("id",uuid(id)).maybeSingle();
  failClosedDb(q.error);
  if (!q.data) throw new FinanceAccountingError("finance_accounting_document_not_found",404);
  await authorize(identity,financeAccountModule(q.data.document_kind));
  return mapDocument(q.data as DbDocument);
}
export async function accountingDocuments(identity: FinanceIdentity,kind: string,branch: string|null) {
  if (branch) validBranch(identity,branch);
  if (!kind || kind.length > 60) throw new FinanceAccountingError("finance_accounting_kind_required");
  await authorize(identity,financeAccountModule(kind));
  const db=getPrimarySupabaseServiceClient();
  const query=db.from("finance_accounting_documents")
    .select("id,tenant_id,branch_id,document_kind,document_no,status,version,amount_minor,currency,counterparty_name,document_date,due_date,prepared_by,approved_by,posted_journal_id,source_document_id",{count:"exact"})
    .eq("tenant_id",identity.tenantId)
    .in("branch_id",branch?[branch]:identity.branchIds)
    .eq("document_kind",kind).order("created_at",{ascending:false}).limit(101);
  const result=await query;
  failClosedDb(result.error);
  if ((result.count??0)>100) throw new FinanceAccountingError("finance_accounting_too_many_records_filter_required",422);
  return { documents:(result.data??[]).map(row=>mapDocument(row as DbDocument)),readOnly:false };
}
export async function accountingAccounts(identity: FinanceIdentity) {
  await authorize(identity,"finance.ledger");
  const r=await getPrimarySupabaseServiceClient().from("finance_accounting_chart")
    .select("id,account_code,account_name,account_type",{count:"exact"})
    .eq("tenant_id",identity.tenantId).order("account_code").limit(501);
  failClosedDb(r.error);
  if ((r.count??0)>500) throw new FinanceAccountingError("finance_accounting_account_limit",422);
  return { accounts:(r.data??[]).map(v=>({id:v.id,code:v.account_code,name:v.account_name,type:v.account_type})) };
}
export async function accountingJournals(identity:FinanceIdentity, branchId:string|null) {
  await authorize(identity,"finance.ledger");
  if(branchId) validBranch(identity,branchId);
  const result=await getPrimarySupabaseServiceClient().from("finance_accounting_journals")
    .select("id,branch_id,document_id,accounting_date,currency,debit_total_minor,credit_total_minor,posted_at,posted_by",{count:"exact"})
    .eq("tenant_id",identity.tenantId).in("branch_id",branchId?[branchId]:identity.branchIds)
    .order("posted_at",{ascending:false}).limit(101);
  failClosedDb(result.error);
  if((result.count??0)>100) throw new FinanceAccountingError("finance_accounting_journals_too_many_filter_required",422);
  return {journals:(result.data??[]).map(j=>({
    id:String(j.id),branchId:String(j.branch_id),documentId:String(j.document_id),
    date:String(j.accounting_date),currency:j.currency as FinanceCurrency,
    debitMinor:Number(j.debit_total_minor),creditMinor:Number(j.credit_total_minor),
    postedAt:String(j.posted_at),postedBy:String(j.posted_by)
  }))};
}
export async function accountingDocumentDetail(identity: FinanceIdentity, id: string) {
  const document = await getAccountingDocument(identity,id);
  const db = getPrimarySupabaseServiceClient();
  const [lines, events] = await Promise.all([
    db.from("finance_accounting_document_lines")
      .select("line_no,description,quantity,unit_minor,line_minor")
      .eq("tenant_id",identity.tenantId).eq("branch_id",document.branchId)
      .eq("document_id",document.id).order("line_no").limit(100),
    db.from("finance_accounting_document_events")
      .select("action,old_status,new_status,created_at,actor_user_id,event_payload")
      .eq("tenant_id",identity.tenantId).eq("branch_id",document.branchId)
      .eq("document_id",document.id).order("created_at",{ascending:false}).limit(101)
  ]);
  failClosedDb(lines.error); failClosedDb(events.error);
  if ((events.data??[]).length>100)
    throw new FinanceAccountingError("finance_accounting_audit_too_many",422);
  return {
    document,
    lines:(lines.data??[]).map(line=>({
      no:Number(line.line_no),description:String(line.description),
      quantity:Number(line.quantity),unitMinor:Number(line.unit_minor),
      totalMinor:Number(line.line_minor)
    })),
    events:(events.data??[]).map(event=>({
      action:String(event.action),previous:String(event.old_status??""),
      current:String(event.new_status),timestamp:String(event.created_at),
      actorId:String(event.actor_user_id)
    }))
  };
}

export async function accountingJournalDetail(identity: FinanceIdentity, id: string) {
  await authorize(identity,"finance.ledger");
  const journalId = uuid(id);
  const db = getPrimarySupabaseServiceClient();
  const result = await db.from("finance_accounting_journals")
    .select("id,branch_id,document_id,accounting_date,currency,debit_total_minor,credit_total_minor,posted_at,posted_by")
    .eq("tenant_id",identity.tenantId).in("branch_id",identity.branchIds)
    .eq("id",journalId).maybeSingle();
  failClosedDb(result.error);
  if(!result.data) throw new FinanceAccountingError("finance_accounting_journal_not_found",404);
  const journal = result.data;
  const items=await db.from("finance_accounting_journal_lines")
    .select("line_no,account_id,currency,debit_minor,credit_minor")
    .eq("tenant_id",identity.tenantId).eq("branch_id",journal.branch_id)
    .eq("journal_id",journalId).order("line_no").limit(101);
  failClosedDb(items.error);
  if((items.data??[]).length>100)
    throw new FinanceAccountingError("finance_accounting_journal_lines_too_many",422);
  const accountIds=[...new Set((items.data??[]).map(item=>String(item.account_id)))];
  const accounts=accountIds.length?await db.from("finance_accounting_chart")
    .select("id,account_code,account_name")
    .eq("tenant_id",identity.tenantId).in("id",accountIds):null;
  if(accounts) failClosedDb(accounts.error);
  const codes=new Map((accounts?.data??[]).map(account=>[
    String(account.id),{code:String(account.account_code),name:String(account.account_name)}
  ]));
  return {
    journal:{id:journalId,documentId:String(journal.document_id),
      date:String(journal.accounting_date),currency:String(journal.currency),
      debitMinor:Number(journal.debit_total_minor),creditMinor:Number(journal.credit_total_minor),
      postedAt:String(journal.posted_at),postedBy:String(journal.posted_by)},
    lines:(items.data??[]).map(item=>({
      no:Number(item.line_no),accountId:String(item.account_id),
      code:codes.get(String(item.account_id))?.code??"-",
      name:codes.get(String(item.account_id))?.name??"-",
      currency:String(item.currency),debitMinor:Number(item.debit_minor),
      creditMinor:Number(item.credit_minor)
    }))
  };
}

export async function accountingAging(identity: FinanceIdentity,side:"AR"|"AP",branchId:string|null,asOf:string) {
  await authorize(identity,side==="AR"?"finance.sales_receivables":"finance.purchases_payables");
  if (branchId) validBranch(identity,branchId);
  const cutoff=day(asOf)!;
  const endBangkokIso=new Date(Date.parse(cutoff+"T00:00:00.000Z")+17*60*60*1000-1).toISOString();
  const db=getPrimarySupabaseServiceClient();
  const doc=await db.from("finance_accounting_documents")
    .select("id,branch_id,currency,due_date,amount_minor,status,posted_journal_id,issued_at",{count:"exact"})
    .eq("tenant_id",identity.tenantId)
    .in("branch_id",branchId?[branchId]:identity.branchIds)
    .eq("document_kind",side==="AR"?"sales_invoice":"supplier_bill")
    .eq("status","issued").not("posted_journal_id","is",null)
    .lte("document_date",cutoff).lte("issued_at",endBangkokIso).limit(501);
  failClosedDb(doc.error);
  if ((doc.count??0)>500) throw new FinanceAccountingError("finance_accounting_aging_too_many",422);
  const docs=doc.data??[];
  if (!docs.length) return {side,asOf:cutoff,buckets:[],documents:[]};
  const ids=docs.map(x=>x.id);
  const allocations=await db.from("finance_accounting_allocations")
    .select("source_document_id,amount_minor,created_at")
    .eq("tenant_id",identity.tenantId).in("branch_id",branchId?[branchId]:identity.branchIds)
    .in("source_document_id",ids).lte("created_at",endBangkokIso).limit(1000);
  failClosedDb(allocations.error);
  if ((allocations.data??[]).length>=1000) throw new FinanceAccountingError("finance_accounting_aging_allocations_too_many",422);
  const applied=new Map<string,number>();
  for(const a of allocations.data??[])
    applied.set(a.source_document_id,(applied.get(a.source_document_id)??0)+Number(a.amount_minor));
  if(docs.some(d=>!d.due_date)) throw new FinanceAccountingError("finance_accounting_due_date_missing",503);
  const records:FinanceAgingRecord[]=docs.map(d=>({
    id:d.id,currency:d.currency as FinanceCurrency,dueDate:d.due_date!,
    originalMinor:Number(d.amount_minor),appliedMinor:applied.get(d.id)??0
  }));
  const buckets=financeAgingAsOf(records,cutoff);
  return {side,asOf:cutoff,buckets,documents:records};
}
export async function accountingCreate(identity: FinanceIdentity,body:Record<string,unknown>) {
  const kind=clean(body.kind,40) as FinanceDocumentKind;
  await authorize(identity,financeAccountModule(kind));
  const branch=validBranch(identity,body.branchId);
  const c=currency(body.currency);
  const lines=body.lines;
  if(!Array.isArray(lines)||lines.length<1||lines.length>100)
    throw new FinanceAccountingError("finance_accounting_lines_invalid");
  const sanitized=lines.map(line=>{
    if (!line||typeof line!=="object") throw new FinanceAccountingError("finance_accounting_line_invalid");
    const v=line as Record<string,unknown>;
    const quantity=v.quantity;
    if(typeof quantity!=="number"||!Number.isFinite(quantity)||quantity<=0||quantity>999999)
      throw new FinanceAccountingError("finance_accounting_quantity_invalid");
    const unitMinor=validMinor(v.unitMinor,true);
    const lineMinor=validMinor(v.lineMinor);
    if(Math.abs(Math.round(quantity*unitMinor)-lineMinor)>0)
      throw new FinanceAccountingError("finance_accounting_line_total_mismatch");
    return {description:clean(v.description,500),quantity,unitMinor,lineMinor};
  });
  const total=sanitized.reduce((sum,line)=>sum+line.lineMinor,0);
  validMinor(total);
  const request=uuid(body.requestKey);
  const evidenceRef=body.evidenceRef==null?"":clean(body.evidenceRef,120);
  const evidenceType=body.evidenceType==null?"":clean(body.evidenceType,40);
  if((kind==="receipt_voucher"||kind==="payment_voucher") &&
    (!["cash_count","bank_transfer","cheque","card"].includes(evidenceType) || !evidenceRef))
    throw new FinanceAccountingError("finance_accounting_payment_evidence_required");
  const params={
    p_tenant:identity.tenantId,p_branch:branch,p_actor:identity.userId,
    p_kind:kind,p_no:clean(body.documentNo,64),p_counterparty:clean(body.counterparty,240),
    p_date:day(body.documentDate),p_due:day(body.dueDate,true),p_currency:c,
    p_lines:sanitized,p_request:request,
    p_source:body.sourceDocumentId?uuid(body.sourceDocumentId):null,
    p_evidence_ref:evidenceRef,p_evidence_type:evidenceType
  };
  const r=await getPrimarySupabaseServiceClient().rpc("finance_accounting_create_document",params);
  failClosedDb(r.error);
  return r.data;
}
export async function accountingTransition(identity:FinanceIdentity,body:Record<string,unknown>) {
  const d=await getAccountingDocument(identity,uuid(body.documentId));
  const branch=validBranch(identity,d.branchId);
  const action=clean(body.transition,12);
  if(!["submit","approve","reject","issue","void"].includes(action))
    throw new FinanceAccountingError("finance_accounting_action_invalid");
  if(typeof body.version!=="number"||!Number.isSafeInteger(body.version))
    throw new FinanceAccountingError("finance_accounting_version_invalid");
  const r=await getPrimarySupabaseServiceClient().rpc("finance_accounting_transition_document",{
    p_tenant:identity.tenantId,p_branch:branch,p_actor:identity.userId,p_document:d.id,
    p_action:action,p_expected_version:body.version,
    p_reason:typeof body.reason==="string"?body.reason.slice(0,500):""
  });
  failClosedDb(r.error);
  return r.data;
}
export async function accountingPost(identity:FinanceIdentity,body:Record<string,unknown>) {
  const d=await getAccountingDocument(identity,uuid(body.documentId));
  await authorize(identity,"finance.ledger");
  const r=await getPrimarySupabaseServiceClient().rpc("finance_accounting_post_document",{
    p_tenant:identity.tenantId,p_branch:validBranch(identity,d.branchId),p_actor:identity.userId,
    p_document:d.id,p_debit_account:uuid(body.debitAccountId),p_credit_account:uuid(body.creditAccountId)
  });
  failClosedDb(r.error);
  return r.data;
}
export async function accountingCreateAccount(identity:FinanceIdentity,body:Record<string,unknown>) {
  await authorize(identity,"finance.ledger");
  const r=await getPrimarySupabaseServiceClient().rpc("finance_accounting_create_account",{
    p_tenant:identity.tenantId,p_branch:validBranch(identity,body.branchId),
    p_actor:identity.userId,p_code:clean(body.code,32),p_name:clean(body.name,160),
    p_type:clean(body.type,12)
  });
  failClosedDb(r.error);
  return r.data;
}
export async function accountingBranches(identity:FinanceIdentity) {
  const r=await getPrimarySupabaseServiceClient().from("branches").select("id,name,code")
    .eq("tenant_id",identity.tenantId).in("id",identity.branchIds).eq("is_active",true);
  failClosedDb(r.error);
  return r.data??[];
}

/** Read-only finance reconciliation for the isolated UAT tenant. Never post GL here. */
export async function accountingWarehouseIntents(identity: FinanceIdentity, branchId: string|null) {
  await authorize(identity,"finance.ledger");
  if (!rwWarehouseUatAllowed(identity.tenantId,{
    VERCEL_ENV:process.env.VERCEL_ENV,
    RW_WAREHOUSE_UAT_ENABLED:process.env.RW_WAREHOUSE_UAT_ENABLED,
    RW_WAREHOUSE_UAT_TENANT_ID:process.env.RW_WAREHOUSE_UAT_TENANT_ID,
    NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,
    RW_WAREHOUSE_UAT_PROJECT_REF:process.env.RW_WAREHOUSE_UAT_PROJECT_REF
  }) || await getCustomPosStockUiMode(identity.tenantId)!=="retail_wholesale")
    throw new FinanceAccountingError("finance_warehouse_uat_disabled",503);
  if(branchId)validBranch(identity,branchId);
  // Only movements with a verified destination in the finance session's authorized branches.
  // Inbound has no branch mapping and is intentionally excluded until purchasing integration.
  const result=await getPrimarySupabaseServiceClient().from("rw_warehouse_finance_intents_candidate")
    .select("ledger_id,request_id,warehouse_id,sku,transfer_id,destination_branch_id,event,created_at,debit_bucket,credit_bucket,amount_minor,posting_status",{count:"exact"})
    .eq("tenant_id",identity.tenantId).in("destination_branch_id",branchId?[branchId]:identity.branchIds)
    .order("created_at",{ascending:false}).limit(101);
  failClosedDb(result.error);
  if((result.count??0)>100)throw new FinanceAccountingError("finance_warehouse_filter_required",422);
  return {intents:result.data??[],readOnly:true,glPosted:false};
}

export async function accountingPostWarehouseTransfer(identity:FinanceIdentity,body:Record<string,unknown>) {
  await authorize(identity,"finance.ledger");
  if(!rwWarehouseUatAllowed(identity.tenantId,{
    VERCEL_ENV:process.env.VERCEL_ENV,RW_WAREHOUSE_UAT_ENABLED:process.env.RW_WAREHOUSE_UAT_ENABLED,
    RW_WAREHOUSE_UAT_TENANT_ID:process.env.RW_WAREHOUSE_UAT_TENANT_ID,
    NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,
    RW_WAREHOUSE_UAT_PROJECT_REF:process.env.RW_WAREHOUSE_UAT_PROJECT_REF
  })||await getCustomPosStockUiMode(identity.tenantId)!=="retail_wholesale")
    throw new FinanceAccountingError("finance_warehouse_uat_disabled",503);
  const result=await getPrimarySupabaseServiceClient().rpc("rw_post_transfer_gl_candidate",{
    p_tenant:identity.tenantId,p_branch:validBranch(identity,body.branchId),
    p_actor:identity.userId,p_ledger:uuid(body.ledgerId)
  });
  failClosedDb(result.error);
  return result.data;
}

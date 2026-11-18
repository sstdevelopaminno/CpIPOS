import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { orderCurrencyFromMetadata, type SalesCurrencyCode } from "@/lib/pos-money";
import { buildOrderTaxSnapshot, isValidThaiTaxId, taxInvoiceNumber,
  type TaxBuyerSnapshot, type TaxInvoiceOrderSnapshot, type TaxInvoiceItemSnapshot,
  type TaxSellerSnapshot, type TaxInvoiceTaxSnapshot } from "@/lib/pos-tax-invoice";

import type { FinanceIdentity } from "@/lib/server/finance-session";

export type FinanceReceiptLine = { name: string; quantity: number; unitPrice: number; lineTotal: number; note: string };
export type FinanceReceiptSnapshot = {
  orderId: string; orderNo: string; branchId: string; branchName: string; currency: SalesCurrencyCode;
  paidAt: string; documentDate: string; customerName: string; note: string;
  items: FinanceReceiptLine[]; discountAmount: number; taxAmount: number; totalAmount: number;
  paidTotal: number; paymentMethod: string; revision: number; voided: boolean;
  correctionReason: string; amendedAt: string | null; originalTotal: number;
};
export type FinanceIssuedTaxInvoice = {
  id: string; invoiceNo: string; issuedAt: string; status: string;
  seller: TaxSellerSnapshot; buyer: TaxBuyerSnapshot; order: TaxInvoiceOrderSnapshot;
  items: TaxInvoiceItemSnapshot[]; tax: TaxInvoiceTaxSnapshot;
};
export type FinanceDocumentDetail = {
  receipt: FinanceReceiptSnapshot;
  original: FinanceReceiptSnapshot;
  invoice: FinanceIssuedTaxInvoice | null;
  store: { name: string; address: string; phone: string };
  revisions: Array<{ id: string; createdAt: string; action: string; reason: string }>;
};
export class FinanceDocumentError extends Error {
  constructor(public code: string, public status = 422) { super(code); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (x: unknown) => {
  const n = Number(x ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new FinanceDocumentError("finance_amount_invalid");
  return Math.round((n + Number.EPSILON) * 100) / 100;
};
const plain = (x: unknown, max: number) => String(x ?? "").trim().slice(0, max);
const isoDay = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(iso));
  const get = (name: string) => parts.find(p => p.type === name)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
};
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function requireUuid(value: string) {
  if (!UUID.test(value)) throw new FinanceDocumentError("finance_order_id_invalid");
}
function branchAllowed(identity: FinanceIdentity, branchId: string) {
  if (!identity.branchIds.includes(branchId)) throw new FinanceDocumentError("finance_branch_forbidden", 403);
}
function revisionRow(value: unknown): FinanceReceiptSnapshot | null {
  const snapshot = asRecord(value).snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot as FinanceReceiptSnapshot;
}

/** Server-only document source: source POS rows are never overwritten by a Finance correction. */
export async function loadFinanceDocument(identity: FinanceIdentity, orderId: string): Promise<FinanceDocumentDetail> {
  requireUuid(orderId);
  const db = getSupabaseServiceClient();
  const { data: order, error: orderError } = await db.from("orders")
    .select("id,order_no,branch_id,status,customer_name,notes,subtotal,discount_amount,tax_total,grand_total,total_amount,paid_total,created_at,payment_completed_at,metadata")
    .eq("tenant_id", identity.tenantId).in("branch_id", identity.branchIds)
    .eq("id", orderId).maybeSingle();
  if (orderError) throw new FinanceDocumentError("finance_receipt_query_failed", 503);
  if (!order || order.status !== "completed" || !order.payment_completed_at)
    throw new FinanceDocumentError("finance_receipt_not_found", 404);
  const branchId = String(order.branch_id);
  branchAllowed(identity, branchId);
  const [branch, lines, payments, invoice, logs, profile] = await Promise.all([
    db.from("branches").select("name").eq("tenant_id", identity.tenantId).eq("id", branchId).single(),
    db.from("order_items").select("name,quantity,unit_price,line_total,notes")
      .eq("tenant_id", identity.tenantId).eq("branch_id", branchId).eq("order_id", orderId)
      .order("created_at").limit(200),
    db.from("payments").select("method,status,amount").eq("tenant_id", identity.tenantId)
      .eq("branch_id", branchId).eq("order_id", orderId).eq("status", "paid").limit(100),
    db.from("pos_tax_invoices").select("id,invoice_no,issued_at,status,seller_snapshot,buyer_snapshot,order_snapshot,items_snapshot,tax_snapshot")
      .eq("tenant_id", identity.tenantId).eq("branch_id", branchId).eq("order_id", orderId).maybeSingle(),
    db.from("audit_logs").select("id,created_at,action,new_value")
      .eq("tenant_id", identity.tenantId).eq("branch_id", branchId)
      .eq("target_table", "orders").eq("target_id", orderId)
      .in("action", ["finance_receipt_corrected", "finance_receipt_voided"])
      .order("created_at", { ascending: true }).limit(200),
    loadReceiptStoreProfile(identity.tenantId)
  ]);
  if (branch.error || lines.error || payments.error || invoice.error || logs.error)
    throw new FinanceDocumentError("finance_receipt_detail_unavailable", 503);
  if ((lines.data ?? []).length >= 200 || (payments.data ?? []).length >= 100 || (logs.data ?? []).length >= 200)
    throw new FinanceDocumentError("finance_document_too_many_rows", 422);
  const original: FinanceReceiptSnapshot = {
    orderId, orderNo: String(order.order_no), branchId, branchName: String(branch.data?.name ?? ""),
    currency: orderCurrencyFromMetadata(order.metadata), paidAt: String(order.payment_completed_at),
    documentDate: isoDay(String(order.payment_completed_at)), customerName: String(order.customer_name ?? ""),
    note: String(order.notes ?? ""), items: (lines.data ?? []).map(item => ({
      name: String(item.name ?? "รายการสินค้า"), quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price), lineTotal: Number(item.line_total),
      note: String(item.notes ?? "")
    })), discountAmount: Number(order.discount_amount ?? 0),
    taxAmount: Number(order.tax_total ?? 0), totalAmount: Number(order.grand_total ?? order.total_amount),
    paidTotal: Number(order.paid_total ?? 0), paymentMethod: String(payments.data?.[0]?.method ?? "unknown"),
    revision: 0, voided: false, correctionReason: "", amendedAt: null,
    originalTotal: Number(order.grand_total ?? order.total_amount)
  };
  let receipt = original;
  const revisions = (logs.data ?? []).map(row => {
    const s = revisionRow(row.new_value);
    if (s && s.orderId === orderId && s.branchId === branchId) receipt = s;
    return {
      id: String(row.id), createdAt: String(row.created_at),
      action: String(row.action), reason: plain(asRecord(row.new_value).reason, 500)
    };
  });
  const i = invoice.data;
  const issuedInvoice: FinanceIssuedTaxInvoice | null = i ? {
    id: String(i.id), invoiceNo: String(i.invoice_no), issuedAt: String(i.issued_at),
    status: String(i.status), seller: i.seller_snapshot as TaxSellerSnapshot,
    buyer: i.buyer_snapshot as TaxBuyerSnapshot, order: i.order_snapshot as TaxInvoiceOrderSnapshot,
    items: i.items_snapshot as TaxInvoiceItemSnapshot[], tax: i.tax_snapshot as TaxInvoiceTaxSnapshot
  } : null;
  return {
    original, receipt, invoice: issuedInvoice,
    store: { name: profile?.display_name || profile?.name || "", address: profile?.company_address || "",
      phone: profile?.contact_phone || "" },
    revisions
  };
}

export type ReceiptEditInput = {
  orderId: string; action: "correct" | "void"; reason: string; expectedRevision: number;
  documentDate?: string; customerName?: string; note?: string; items?: FinanceReceiptLine[];
  discountAmount?: number; taxAmount?: number; totalAmount?: number;
};
export async function appendFinanceReceiptCorrection(
  identity: FinanceIdentity, input: ReceiptEditInput, request: Request
): Promise<FinanceDocumentDetail> {
  const old = await loadFinanceDocument(identity, input.orderId);
  if (old.invoice && old.invoice.status !== "voided")
    throw new FinanceDocumentError("finance_tax_invoice_requires_credit_or_replacement", 409);
  if (old.receipt.revision !== input.expectedRevision)
    throw new FinanceDocumentError("finance_receipt_revision_conflict", 409);
  if (old.receipt.voided) throw new FinanceDocumentError("finance_receipt_already_void", 409);
  if (!input.reason || input.reason.trim().length < 10 || input.reason.length > 500)
    throw new FinanceDocumentError("finance_correction_reason_required", 422);
  const snapshot: FinanceReceiptSnapshot = {
    ...old.receipt, revision: old.receipt.revision + 1, correctionReason: input.reason.trim(),
    amendedAt: new Date().toISOString(), voided: input.action === "void"
  };
  if (input.action === "correct") {
    const date = String(input.documentDate ?? "");
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date + "T00:00:00+07:00")) ||
      isoDay(new Date(date + "T00:00:00+07:00").toISOString()) !== date)
      throw new FinanceDocumentError("finance_document_date_invalid");
    const rawLines = input.items;
    if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 100)
      throw new FinanceDocumentError("finance_document_items_invalid");
    const items = rawLines.map(item => {
      const qty = Number(item.quantity), unit = Number(item.unitPrice);
      if (!plain(item.name, 160) || !Number.isFinite(qty) || qty <= 0 || qty > 1e6 ||
        !Number.isFinite(unit) || unit < 0 || unit > 1e9)
        throw new FinanceDocumentError("finance_document_item_invalid");
      const lineTotal = money(Math.round(qty * unit * 100) / 100);
      return { name: plain(item.name, 160), quantity: qty, unitPrice: unit,
        lineTotal, note: plain(item.note, 500) };
    });
    const discount = money(input.discountAmount);
    const tax = money(input.taxAmount);
    const total = money(input.totalAmount);
    const expected = Math.round((items.reduce((sum, item) => sum + item.lineTotal, 0) - discount + tax) * 100) / 100;
    if (Math.abs(total - expected) > (snapshot.currency === "LAK" ? 0.5 : 0.01))
      throw new FinanceDocumentError("finance_document_total_mismatch");
    Object.assign(snapshot, {
      documentDate: date, customerName: plain(input.customerName, 160), note: plain(input.note, 1000),
      items, discountAmount: discount, taxAmount: tax, totalAmount: total
    });
  }
  const db = getSupabaseServiceClient();
  // This is one append-only correction event, not an UPDATE of a POS order or issued tax invoice.
  const { error } = await db.from("audit_logs").insert({
    tenant_id: identity.tenantId, branch_id: snapshot.branchId,
    actor_user_id: identity.userId, actor_role: "accountant",
    action: input.action === "void" ? "finance_receipt_voided" : "finance_receipt_corrected",
    target_table: "orders", target_id: snapshot.orderId,
    old_value: { snapshot: old.receipt }, new_value: { snapshot, reason: input.reason.trim() },
    metadata: { module: "finance_documents", version: snapshot.revision,
      original_order_total: old.original.totalAmount,
      document_type: "receipt_correction", user_agent: request.headers.get("user-agent")?.slice(0, 250) },
    module: "finance", entity_type: "receipt", entity_id: snapshot.orderId,
    before_data: { revision: old.receipt.revision }, after_data: { revision: snapshot.revision }
  });
  if (error) throw new FinanceDocumentError("finance_receipt_audit_write_failed", 503);
  return loadFinanceDocument(identity, input.orderId);
}

export async function loadAccountantTaxProfiles(identity: FinanceIdentity, branchId: string) {
  branchAllowed(identity, branchId);
  const { data, error } = await getSupabaseServiceClient().from("pos_tax_invoice_profiles")
    .select("id,display_name,tax_id,entity_type,address_line,subdistrict,district,province,postal_code")
    .eq("tenant_id", identity.tenantId).eq("branch_id", branchId).eq("is_active", true)
    .order("display_name").limit(100);
  if (error) throw new FinanceDocumentError("finance_tax_buyers_unavailable", 503);
  return data ?? [];
}

export async function issueAccountantTaxInvoice(identity: FinanceIdentity, orderId: string, buyerId: string) {
  requireUuid(buyerId);
  const detail = await loadFinanceDocument(identity, orderId);
  if (detail.receipt.revision !== 0 || detail.receipt.voided)
    throw new FinanceDocumentError("finance_tax_invoice_correction_pending", 409);
  if (detail.receipt.currency !== "THB")
    throw new FinanceDocumentError("finance_tax_invoice_thb_only", 409);
  if (detail.invoice) throw new FinanceDocumentError("finance_tax_invoice_already_exists", 409);
  const db = getSupabaseServiceClient();
  const branchId = detail.original.branchId;
  const [buyer, settings, order] = await Promise.all([
    db.from("pos_tax_invoice_profiles")
      .select("id,entity_type,display_name,tax_id,address_line,subdistrict,district,province,postal_code")
      .eq("tenant_id", identity.tenantId).eq("branch_id", branchId)
      .eq("id", buyerId).eq("is_active", true).maybeSingle(),
    db.from("tenant_tax_settings").select("is_enabled,settings")
      .eq("tenant_id", identity.tenantId).eq("branch_id", branchId).maybeSingle(),
    db.from("orders").select("id,order_no,status,created_at,payment_completed_at,subtotal,discount_amount,tax_total,grand_total,total_amount,paid_total,customer_name,metadata")
      .eq("tenant_id", identity.tenantId).eq("branch_id", branchId)
      .eq("id", orderId).maybeSingle()
  ]);
  if (buyer.error || settings.error || order.error) throw new FinanceDocumentError("finance_tax_source_unavailable", 503);
  if (!buyer.data || !order.data || order.data.status !== "completed")
    throw new FinanceDocumentError("finance_tax_source_invalid", 409);
  if (!settings.data?.is_enabled)
    throw new FinanceDocumentError("finance_tax_vat_not_enabled", 409);
  const taxSettings = asRecord(settings.data.settings);
  // Tax ID and a POS VAT toggle do not establish a verified VAT registration.
  if (taxSettings.vat_registration_verified !== true)
    throw new FinanceDocumentError("finance_tax_vat_verification_required", 409);
  const seller: TaxSellerSnapshot = {
    display_name: plain(taxSettings.seller_display_name, 240) || detail.store.name,
    tax_id: String(taxSettings.seller_tax_id ?? "").replace(/\D/g, ""),
    branch_no: String(taxSettings.seller_branch_no ?? "").replace(/\D/g, ""),
    address: plain(taxSettings.seller_address, 500) || detail.store.address,
    phone: detail.store.phone
  };
  if (!seller.display_name || !seller.address || !isValidThaiTaxId(seller.tax_id))
    throw new FinanceDocumentError("finance_tax_seller_vat_profile_required", 409);
  if (!isValidThaiTaxId(buyer.data.tax_id))
    throw new FinanceDocumentError("finance_tax_buyer_invalid", 409);
  const tax = buildOrderTaxSnapshot(order.data.tax_total, order.data.metadata);
  if (tax.warning || (tax.lines.length === 0 && tax.tax_total <= 0))
    throw new FinanceDocumentError("finance_tax_billed_tax_missing", 409);
  const buyerSnapshot: TaxBuyerSnapshot = {
    entity_type: buyer.data.entity_type as TaxBuyerSnapshot["entity_type"],
    display_name: String(buyer.data.display_name), tax_id: String(buyer.data.tax_id),
    address_line: String(buyer.data.address_line), subdistrict: String(buyer.data.subdistrict),
    district: String(buyer.data.district), province: String(buyer.data.province),
    postal_code: String(buyer.data.postal_code)
  };
  const o = order.data;
  const snap: TaxInvoiceOrderSnapshot = {
    order_id: String(o.id), order_no: String(o.order_no), created_at: String(o.created_at),
    paid_at: o.payment_completed_at,
    subtotal: Number(o.subtotal ?? 0), discount_amount: Number(o.discount_amount ?? 0),
    tax_total: Number(o.tax_total ?? 0), grand_total: Number(o.grand_total ?? o.total_amount),
    paid_total: Number(o.paid_total ?? 0), customer_name: o.customer_name
  };
  const intent = await db.from("audit_logs").insert({
    tenant_id: identity.tenantId, branch_id: branchId, actor_user_id: identity.userId,
    actor_role: "accountant", action: "finance_tax_invoice_issue_requested",
    target_table: "orders", target_id: orderId, module: "finance", entity_type: "tax_invoice",
    metadata: { buyer_id: buyerId, order_no: o.order_no }
  });
  if (intent.error) throw new FinanceDocumentError("finance_tax_audit_unavailable", 503);
  const { data, error } = await db.from("pos_tax_invoices").insert({
    tenant_id: identity.tenantId, branch_id: branchId, order_id: orderId,
    profile_id: buyerId, invoice_no: taxInvoiceNumber(String(o.order_no)),
    buyer_snapshot: buyerSnapshot, seller_snapshot: seller, order_snapshot: snap,
    tax_snapshot: tax, items_snapshot: detail.original.items.map(item => ({
      name: item.name, quantity: item.quantity, unit_price: item.unitPrice,
      line_total: item.lineTotal, notes: item.note
    })), payments_snapshot: [],
    paper_width_mm: 80, issued_by: identity.userId,
    metadata: { source: "finance_accountant", issued_from_pos_original: true }
  }).select("id,invoice_no").single();
  if (error) throw new FinanceDocumentError(error.code === "23505" ?
    "finance_tax_invoice_already_exists" : "finance_tax_issue_failed", error.code === "23505" ? 409 : 503);
  const audit = await db.from("audit_logs").insert({
    tenant_id: identity.tenantId, branch_id: branchId, actor_user_id: identity.userId,
    actor_role: "accountant", action: "finance_tax_invoice_issued",
    target_table: "pos_tax_invoices", target_id: data.id,
    module: "finance", entity_type: "tax_invoice",
    metadata: { order_id: orderId, invoice_no: data.invoice_no, buyer_id: buyerId }
  });
  if (audit.error) {
    console.error("[finance/tax] post-issue audit incomplete", audit.error.message);
    throw new FinanceDocumentError("finance_tax_audit_reconcile_required", 503);
  }
  return { id: String(data.id), invoiceNo: String(data.invoice_no) };
}

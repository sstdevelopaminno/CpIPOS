import { appendAuditLog } from "@/lib/audit-log";
import { filterBillingDocumentItems } from "@/lib/billing-document-policy";
import { fail, ok } from "@/lib/http";
import { validateManagerPin } from "@/lib/pin-approval";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { requirePosSession } from "@/lib/pos-session-guard";
import {
  assertThaiAddressOption,
  buildOrderTaxSnapshot,
  isTaxEntityType,
  isValidThaiTaxId,
  lookupThaiAddressByPostalCode,
  normalizeDigits,
  taxInvoiceNumber,
  type TaxBuyerSnapshot,
  type TaxInvoiceItemSnapshot,
  type TaxInvoiceOrderSnapshot,
  type TaxInvoiceTaxSnapshot,
  type TaxSellerSnapshot
} from "@/lib/pos-tax-invoice";
import { queueRoutedTaxInvoice } from "@/lib/printing/tax-invoice-print-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type ProfileRow = TaxBuyerSnapshot & {
  id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type InvoiceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  profile_id: string;
  order_id: string;
  invoice_no: string;
  buyer_snapshot: TaxBuyerSnapshot;
  seller_snapshot: TaxSellerSnapshot;
  order_snapshot: TaxInvoiceOrderSnapshot;
  tax_snapshot: TaxInvoiceTaxSnapshot;
  items_snapshot: TaxInvoiceItemSnapshot[];
  payments_snapshot: unknown[];
  paper_width_mm: number;
  print_count: number;
  issued_at: string;
  last_printed_at: string | null;
};

type OrderRow = {
  id: string;
  order_no: string;
  customer_name: string | null;
  subtotal: number | null;
  discount_amount: number | null;
  tax_total: number | null;
  grand_total: number | null;
  total_amount: number | null;
  paid_total: number | null;
  status: string;
  created_at: string;
  payment_completed_at: string | null;
  metadata: unknown;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function requireTaxScope() {
  const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
  const scope = await requirePosSession();
  if (scope.session.tenant_id !== auth.tenantId || scope.session.branch_id !== auth.branchId) {
    throw new Error("pos_scope_mismatch");
  }
  return { auth, scope };
}

async function loadSellerSnapshot(tenantId: string, branchId: string): Promise<{ seller: TaxSellerSnapshot; ready: boolean }> {
  const supabase = getSupabaseServiceClient();
  const [storeProfile, taxResult] = await Promise.all([
    loadReceiptStoreProfile(tenantId),
    supabase
      .from("tenant_tax_settings")
      .select("settings")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .maybeSingle<{ settings: JsonRecord | null }>()
  ]);
  if (taxResult.error) throw new Error(taxResult.error.message);
  const settings = asRecord(taxResult.data?.settings);
  const seller: TaxSellerSnapshot = {
    display_name: text(settings.seller_display_name) || text(storeProfile?.display_name) || text(storeProfile?.name),
    tax_id: normalizeDigits(settings.seller_tax_id),
    branch_no: normalizeDigits(settings.seller_branch_no),
    address: text(settings.seller_address) || text(storeProfile?.company_address),
    phone: text(storeProfile?.contact_phone)
  };
  return {
    seller,
    ready: Boolean(seller.display_name && seller.address && isValidThaiTaxId(seller.tax_id))
  };
}

async function loadReceiptDetail(tenantId: string, branchId: string, orderId: string, billingScope?: { tenantCode?: string | null; tenantMetadata?: unknown }) {
  const supabase = getSupabaseServiceClient();
  const [orderResult, itemsResult, paymentsResult, invoiceResult, sellerResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id,order_no,customer_name,subtotal,discount_amount,tax_total,grand_total,total_amount,paid_total,status,created_at,payment_completed_at,metadata")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("id", orderId)
      .maybeSingle<OrderRow>(),
    supabase
      .from("order_items")
      .select("name,quantity,unit_price,line_total,notes")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    supabase
      .from("payments")
      .select("method,amount,status,received_at,reference_no")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("order_id", orderId)
      .order("received_at", { ascending: true }),
    supabase
      .from("pos_tax_invoices")
      .select("id,tenant_id,branch_id,profile_id,order_id,invoice_no,buyer_snapshot,seller_snapshot,order_snapshot,tax_snapshot,items_snapshot,payments_snapshot,paper_width_mm,print_count,issued_at,last_printed_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("order_id", orderId)
      .maybeSingle<InvoiceRow>(),
    loadSellerSnapshot(tenantId, branchId)
  ]);
  if (orderResult.error) throw new Error(orderResult.error.message);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (invoiceResult.error) throw new Error(invoiceResult.error.message);
  if (!orderResult.data) throw new Error("order_not_found");
  const order = orderResult.data;
  const orderSnapshot: TaxInvoiceOrderSnapshot = {
    order_id: order.id,
    order_no: order.order_no,
    created_at: order.created_at,
    paid_at: order.payment_completed_at,
    subtotal: Number(order.subtotal ?? 0),
    discount_amount: Number(order.discount_amount ?? 0),
    tax_total: Number(order.tax_total ?? 0),
    grand_total: Number(order.grand_total ?? order.total_amount ?? 0),
    paid_total: Number(order.paid_total ?? 0),
    customer_name: order.customer_name
  };
  const mappedItems: TaxInvoiceItemSnapshot[] = (itemsResult.data ?? []).map((item) => ({
    name: text(item.name) || "รายการสินค้า",
    quantity: Number(item.quantity ?? 0),
    unit_price: Number(item.unit_price ?? 0),
    line_total: Number(item.line_total ?? 0),
    notes: item.notes == null ? null : String(item.notes)
  }));
  const items = filterBillingDocumentItems(mappedItems, billingScope, (item) => item.unit_price);
  return {
    order,
    order_snapshot: orderSnapshot,
    items,
    payments: paymentsResult.data ?? [],
    tax: buildOrderTaxSnapshot(order.tax_total, order.metadata),
    invoice: invoiceResult.data ?? null,
    seller: sellerResult.seller,
    seller_ready: sellerResult.ready
  };
}

export async function GET(request: Request) {
  try {
    const { auth, scope } = await requireTaxScope();
    const tenantId = auth.tenantId!;
    const branchId = auth.branchId!;
    const supabase = getSupabaseServiceClient();
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "profiles";

    if (mode === "address") {
      const postalCode = normalizeDigits(url.searchParams.get("postal_code"));
      if (!/^\d{5}$/.test(postalCode)) return fail("postal_code_invalid", "กรุณากรอกรหัสไปรษณีย์ 5 หลัก", 422);
      const options = await lookupThaiAddressByPostalCode(postalCode);
      return ok({ postal_code: postalCode, options, source: "thailand-geography-json" });
    }

    if (mode === "seller") {
      const seller = await loadSellerSnapshot(tenantId, branchId);
      return ok(seller);
    }

    if (mode === "receipts") {
      const q = text(url.searchParams.get("q"));
      let query = supabase
        .from("orders")
        .select("id,order_no,customer_name,grand_total,total_amount,tax_total,status,created_at,payment_completed_at")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(20);
      if (q) query = query.ilike("order_no", `%${q.replace(/[%_]/g, "")}%`);
      const { data, error } = await query;
      if (error) return fail("tax_receipts_query_failed", error.message, 500);
      const orderIds = (data ?? []).map((row) => String(row.id));
      const issued = orderIds.length
        ? await supabase
            .from("pos_tax_invoices")
            .select("id,order_id,invoice_no,profile_id,issued_at,print_count")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .in("order_id", orderIds)
        : { data: [], error: null };
      if (issued.error) return fail("tax_invoice_query_failed", issued.error.message, 500);
      const issuedMap = new Map((issued.data ?? []).map((row) => [String(row.order_id), row]));
      return ok({
        records: (data ?? []).map((row) => ({
          id: row.id,
          order_no: row.order_no,
          customer_name: row.customer_name,
          total: Number(row.grand_total ?? row.total_amount ?? 0),
          tax_total: Number(row.tax_total ?? 0),
          created_at: row.created_at,
          paid_at: row.payment_completed_at,
          invoice: issuedMap.get(String(row.id)) ?? null
        }))
      });
    }

    if (mode === "receipt_detail") {
      const orderId = text(url.searchParams.get("order_id"));
      if (!orderId) return fail("order_id_required", "order_id is required", 422);
      const detail = await loadReceiptDetail(tenantId, branchId, orderId, { tenantCode: scope.tenant?.code, tenantMetadata: scope.tenant?.metadata });
      return ok(detail);
    }

    const q = text(url.searchParams.get("q"));
    let profilesQuery = supabase
      .from("pos_tax_invoice_profiles")
      .select("id,entity_type,display_name,tax_id,address_line,subdistrict,district,province,postal_code,is_active,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (q) {
      const safe = q.replace(/[%_,]/g, "");
      profilesQuery = profilesQuery.or(`display_name.ilike.%${safe}%,tax_id.ilike.%${safe}%`);
    }
    const { data: profiles, error: profilesError } = await profilesQuery;
    if (profilesError) return fail("tax_profiles_query_failed", profilesError.message, 500);
    const profileIds = (profiles ?? []).map((row) => String(row.id));
    const invoices = profileIds.length
      ? await supabase
          .from("pos_tax_invoices")
          .select("profile_id,issued_at")
          .eq("tenant_id", tenantId)
          .eq("branch_id", branchId)
          .in("profile_id", profileIds)
      : { data: [], error: null };
    if (invoices.error) return fail("tax_invoice_query_failed", invoices.error.message, 500);
    const stats = new Map<string, { count: number; last: string | null }>();
    for (const row of invoices.data ?? []) {
      const key = String(row.profile_id);
      const current = stats.get(key) ?? { count: 0, last: null };
      current.count += 1;
      if (!current.last || String(row.issued_at) > current.last) current.last = String(row.issued_at);
      stats.set(key, current);
    }
    return ok({
      profiles: (profiles ?? []).map((profile) => ({
        ...profile,
        invoice_count: stats.get(String(profile.id))?.count ?? 0,
        last_issued_at: stats.get(String(profile.id))?.last ?? null
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith("thai_address_source_")) return fail("thai_address_unavailable", "ระบบค้นหาที่อยู่ไทยไม่พร้อมใช้งาน กรุณาลองใหม่", 503);
    if (message === "pos_scope_mismatch") return fail("pos_scope_mismatch", "POS session scope mismatch", 403);
    if (message === "order_not_found") return fail("order_not_found", "ไม่พบบิลในสาขานี้", 404);
    return fail("tax_invoice_failed", message, 400);
  }
}

export async function POST(request: Request) {
  try {
    const { auth, scope } = await requireTaxScope();
    const tenantId = auth.tenantId!;
    const branchId = auth.branchId!;
    const supabase = getSupabaseServiceClient();
    const body = (await request.json().catch(() => null)) as JsonRecord | null;
    const action = text(body?.action);

    if (action === "save_profile") {
      const entityType = body?.entity_type;
      const displayName = text(body?.display_name);
      const taxId = normalizeDigits(body?.tax_id);
      const addressLine = text(body?.address_line);
      if (!isTaxEntityType(entityType)) return fail("entity_type_invalid", "กรุณาเลือกประเภทนามผู้เสียภาษี", 422);
      if (!displayName) return fail("display_name_required", "กรุณากรอกชื่อสำหรับออกใบกำกับภาษี", 422);
      if (!isValidThaiTaxId(taxId)) return fail("tax_id_invalid", "เลขผู้เสียภาษี 13 หลักไม่ถูกต้อง", 422);
      if (!addressLine) return fail("address_required", "กรุณากรอกบ้านเลขที่/ถนน/รายละเอียดที่อยู่", 422);
      const address = await assertThaiAddressOption({
        postal_code: body?.postal_code,
        subdistrict: body?.subdistrict,
        district: body?.district,
        province: body?.province
      });
      const { data, error } = await supabase
        .from("pos_tax_invoice_profiles")
        .insert({
          tenant_id: tenantId,
          branch_id: branchId,
          entity_type: entityType,
          display_name: displayName,
          tax_id: taxId,
          address_line: addressLine,
          subdistrict: address.subdistrict,
          district: address.district,
          province: address.province,
          postal_code: address.postal_code,
          created_by: auth.userId,
          updated_by: auth.userId
        })
        .select("id,entity_type,display_name,tax_id,address_line,subdistrict,district,province,postal_code,is_active,created_at,updated_at")
        .single();
      if (error) {
        if (error.code === "23505") return fail("tax_profile_exists", "เลขผู้เสียภาษีนี้มีอยู่ในทะเบียนของสาขาแล้ว", 409);
        return fail("tax_profile_save_failed", error.message, 500);
      }
      await appendAuditLog({
        tenantId,
        branchId,
        actorUserId: auth.userId,
        actorRole: auth.branchRole ?? auth.platformRole,
        action: "tax_invoice_profile_created",
        targetTable: "pos_tax_invoice_profiles",
        targetId: String(data.id),
        metadata: { tax_id_last4: taxId.slice(-4), entity_type: entityType }
      });
      return ok({ profile: data, message: "บันทึกข้อมูลผู้เสียภาษีสำเร็จ" });
    }

    if (action === "save_seller") {
      if (auth.branchRole !== "owner" && auth.branchRole !== "manager") {
        return fail("forbidden_role", "เฉพาะ Owner หรือ Manager ตั้งค่าผู้ออกใบกำกับภาษีได้", 403);
      }
      const sellerTaxId = normalizeDigits(body?.seller_tax_id);
      const sellerName = text(body?.seller_display_name);
      const sellerAddress = text(body?.seller_address);
      const sellerBranchNo = normalizeDigits(body?.seller_branch_no);
      if (!isValidThaiTaxId(sellerTaxId)) return fail("seller_tax_id_invalid", "เลขผู้เสียภาษีของร้าน 13 หลักไม่ถูกต้อง", 422);
      if (!sellerName || !sellerAddress) return fail("seller_profile_incomplete", "กรุณากรอกชื่อและที่อยู่ผู้ออกใบกำกับภาษี", 422);
      if (sellerBranchNo && !/^\d{5}$/.test(sellerBranchNo)) return fail("seller_branch_invalid", "เลขสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00000", 422);
      const existing = await supabase
        .from("tenant_tax_settings")
        .select("is_enabled,calculation_base,settings")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .maybeSingle<{ is_enabled: boolean | null; calculation_base: string | null; settings: JsonRecord | null }>();
      if (existing.error) return fail("tax_settings_query_failed", existing.error.message, 500);
      const settings = {
        ...asRecord(existing.data?.settings),
        seller_tax_id: sellerTaxId,
        seller_display_name: sellerName,
        seller_address: sellerAddress,
        seller_branch_no: sellerBranchNo
      };
      const saved = await supabase.from("tenant_tax_settings").upsert(
        {
          tenant_id: tenantId,
          branch_id: branchId,
          is_enabled: existing.data?.is_enabled === true,
          calculation_base: existing.data?.calculation_base || "net_after_discount",
          settings,
          updated_at: new Date().toISOString()
        },
        { onConflict: "tenant_id,branch_id" }
      );
      if (saved.error) return fail("seller_profile_save_failed", saved.error.message, 500);
      await appendAuditLog({
        tenantId,
        branchId,
        actorUserId: auth.userId,
        actorRole: auth.branchRole ?? auth.platformRole,
        action: "tax_invoice_seller_profile_saved",
        targetTable: "tenant_tax_settings",
        metadata: { tax_id_last4: sellerTaxId.slice(-4), seller_branch_no: sellerBranchNo || null }
      });
      return ok({ message: "บันทึกข้อมูลผู้ออกใบกำกับภาษีสำเร็จ" });
    }

    if (action === "print_invoice") {
      const profileId = text(body?.profile_id);
      const orderId = text(body?.order_id);
      const managerPin = text(body?.manager_pin);
      if (!profileId || !orderId) return fail("tax_invoice_selection_required", "กรุณาเลือกลูกค้าและบิล", 422);
      if (managerPin.length < 4) return fail("pin_required", "กรุณากรอก PIN Owner/Manager เพื่อยืนยันการออกใบกำกับภาษี", 422);
      const approval = await validateManagerPin("sales_record_edit", managerPin, { tenantId, branchId });
      if (!approval.approved || !approval.approverUserId || !approval.approverRole || approval.approverRole === "it_admin") {
        return fail("pin_rejected", "PIN Owner/Manager ไม่ถูกต้อง", 403);
      }
      const profileResult = await supabase
        .from("pos_tax_invoice_profiles")
        .select("id,entity_type,display_name,tax_id,address_line,subdistrict,district,province,postal_code,is_active,created_at,updated_at")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("id", profileId)
        .eq("is_active", true)
        .maybeSingle<ProfileRow>();
      if (profileResult.error) return fail("tax_profile_query_failed", profileResult.error.message, 500);
      if (!profileResult.data) return fail("tax_profile_not_found", "ไม่พบข้อมูลผู้เสียภาษีในสาขานี้", 404);
      const detail = await loadReceiptDetail(tenantId, branchId, orderId, { tenantCode: scope.tenant?.code, tenantMetadata: scope.tenant?.metadata });
      if (detail.order.status !== "completed") return fail("order_not_completed", "ออกใบกำกับภาษีได้เฉพาะบิลที่ชำระเสร็จแล้ว", 409);
      if (!detail.seller_ready) return fail("seller_tax_profile_required", "กรุณาตั้งค่าชื่อ ที่อยู่ และเลขผู้เสียภาษีของร้านก่อนออกใบกำกับภาษี", 409);

      let invoice = detail.invoice;
      if (invoice && invoice.profile_id !== profileId) {
        return fail("tax_invoice_already_issued", `บิลนี้ออกใบกำกับภาษีเลขที่ ${invoice.invoice_no} ให้ผู้รับรายอื่นแล้ว`, 409);
      }
      if (!invoice) {
        const buyer: TaxBuyerSnapshot = {
          entity_type: profileResult.data.entity_type,
          display_name: profileResult.data.display_name,
          tax_id: profileResult.data.tax_id,
          address_line: profileResult.data.address_line,
          subdistrict: profileResult.data.subdistrict,
          district: profileResult.data.district,
          province: profileResult.data.province,
          postal_code: profileResult.data.postal_code
        };
        const invoiceNo = taxInvoiceNumber(detail.order.order_no);
        const inserted = await supabase
          .from("pos_tax_invoices")
          .insert({
            tenant_id: tenantId,
            branch_id: branchId,
            profile_id: profileId,
            order_id: orderId,
            invoice_no: invoiceNo,
            buyer_snapshot: buyer,
            seller_snapshot: detail.seller,
            order_snapshot: detail.order_snapshot,
            tax_snapshot: detail.tax,
            items_snapshot: detail.items,
            payments_snapshot: detail.payments,
            paper_width_mm: 58,
            issued_by: approval.approverUserId,
            metadata: { source: "pos_tax_invoice_v1", requested_by: auth.userId }
          })
          .select("id,tenant_id,branch_id,profile_id,order_id,invoice_no,buyer_snapshot,seller_snapshot,order_snapshot,tax_snapshot,items_snapshot,payments_snapshot,paper_width_mm,print_count,issued_at,last_printed_at")
          .single<InvoiceRow>();
        if (inserted.error) {
          if (inserted.error.code !== "23505") return fail("tax_invoice_issue_failed", inserted.error.message, 500);
          const existing = await supabase
            .from("pos_tax_invoices")
            .select("id,tenant_id,branch_id,profile_id,order_id,invoice_no,buyer_snapshot,seller_snapshot,order_snapshot,tax_snapshot,items_snapshot,payments_snapshot,paper_width_mm,print_count,issued_at,last_printed_at")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .eq("order_id", orderId)
            .maybeSingle<InvoiceRow>();
          if (existing.error || !existing.data) return fail("tax_invoice_issue_failed", existing.error?.message ?? "Duplicate invoice lookup failed", 500);
          if (existing.data.profile_id !== profileId) return fail("tax_invoice_already_issued", `บิลนี้ออกใบกำกับภาษีเลขที่ ${existing.data.invoice_no} แล้ว`, 409);
          invoice = existing.data;
        } else {
          invoice = inserted.data;
        }
      }

      const invoiceItems = filterBillingDocumentItems(invoice.items_snapshot, { tenantCode: scope.tenant?.code, tenantMetadata: scope.tenant?.metadata }, (item) => item.unit_price);
      const printResult = await queueRoutedTaxInvoice({
        auth,
        runtimeDeviceCode: scope.session.device_code,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoice_no,
        issuedAt: invoice.issued_at,
        orderId: invoice.order_id,
        seller: invoice.seller_snapshot,
        buyer: invoice.buyer_snapshot,
        order: invoice.order_snapshot,
        items: invoiceItems,
        tax: invoice.tax_snapshot
      });
      const printedAt = new Date().toISOString();
      const primaryWidth = printResult.paper_widths[0] ?? (invoice.paper_width_mm === 80 ? 80 : 58);
      const updated = await supabase
        .from("pos_tax_invoices")
        .update({
          print_count: Number(invoice.print_count ?? 0) + 1,
          paper_width_mm: primaryWidth,
          last_printed_at: printedAt,
          updated_at: printedAt
        })
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("id", invoice.id);
      if (updated.error) return fail("tax_invoice_print_state_failed", updated.error.message, 500);
      await appendAuditLog({
        tenantId,
        branchId,
        actorUserId: approval.approverUserId,
        actorRole: approval.approverRole,
        action: "tax_invoice_printed",
        targetTable: "pos_tax_invoices",
        targetId: invoice.id,
        metadata: {
          requested_by: auth.userId,
          invoice_no: invoice.invoice_no,
          order_id: orderId,
          paper_widths: printResult.paper_widths,
          job_count: printResult.jobs.length
        }
      });
      return ok({
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        issued_at: invoice.issued_at,
        tax_warning: invoice.tax_snapshot.warning,
        paper_widths: printResult.paper_widths,
        jobs: printResult.jobs
      });
    }

    return fail("tax_invoice_action_invalid", "Unknown tax invoice action", 422);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "thai_address_selection_invalid") return fail("thai_address_selection_invalid", "ตำบล/อำเภอ/จังหวัดไม่ตรงกับรหัสไปรษณีย์ที่เลือก", 422);
    if (message.startsWith("thai_address_source_")) return fail("thai_address_unavailable", "ระบบค้นหาที่อยู่ไทยไม่พร้อมใช้งาน กรุณาลองใหม่", 503);
    if (message === "receipt_printer_not_configured") return fail("receipt_printer_not_configured", "ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จ/พิมพ์ย้อนหลังสำหรับเครื่องนี้", 422);
    if (message === "pos_scope_mismatch") return fail("pos_scope_mismatch", "POS session scope mismatch", 403);
    if (message === "order_not_found") return fail("order_not_found", "ไม่พบบิลในสาขานี้", 404);
    return fail("tax_invoice_failed", message, 400);
  }
}

import "server-only";

import type { PaymentMethod } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { readEnv } from "@/lib/env";
import { enqueuePrintJob, loadReceiptSellerName, processPrintJob, renderKitchenTicketTemplate, renderReceiptTemplate } from "@/lib/printing/print-service";
import { renderPaymentNoticeHtml, type PaymentNoticeItem } from "@/lib/printing/payment-notice-html-template";
import { renderKitchenTicketHtml } from "@/lib/printing/kitchen-ticket-html-template";
import { renderReceiptHtml } from "@/lib/printing/receipt-html-template";
import { resolvePrinterRoutes, type ResolvedPrinterRoute } from "@/lib/printing/printer-routing-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type ReceiptSnapshotItem = {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  note?: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readStringArray(value: unknown) {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function routeUsesAgent(route: ResolvedPrinterRoute) {
  const metadata = asRecord(route.printer.metadata);
  return (
    readStringArray(metadata.agent_device_code ?? metadata.agent_device_codes ?? metadata.device_code ?? metadata.device_codes).length > 0 ||
    readStringArray(metadata.assigned_agent_id ?? metadata.assigned_agent_ids ?? metadata.agent_id ?? metadata.agent_ids).length > 0 ||
    metadata.print_mode === "agent" ||
    metadata.processing_mode === "print_agent" ||
    metadata.queue_only === true
  );
}

function shouldDefer(route: ResolvedPrinterRoute) {
  const metadata = asRecord(route.printer.metadata);
  if (metadata.server_direct_print === true || metadata.process_on_server === true || metadata.print_mode === "server") return false;
  if (routeUsesAgent(route)) return true;
  return readEnv("VERCEL") === "1" || Boolean(readEnv("VERCEL_ENV"));
}

const KITCHEN_TICKET_PRINT_SELECT_WITH_ROUND = "id,order_id,zone_id,event_type,order_no,order_type,table_id,customer_name,order_notes,queue_no,round_no,created_at,metadata,kitchen_zones(id,zone_code,zone_name,kds_enabled,default_printer_id)";
const KITCHEN_TICKET_PRINT_SELECT_BASE = "id,order_id,zone_id,event_type,order_no,order_type,table_id,customer_name,order_notes,queue_no,created_at,metadata,kitchen_zones(id,zone_code,zone_name,kds_enabled,default_printer_id)";

function isMissingRoundNoError(error: { message?: string } | null | undefined) {
  return Boolean(error?.message?.includes("kitchen_tickets.round_no") || error?.message?.includes("round_no does not exist"));
}

function kitchenTableLabel(metadata: unknown): string | null {
  const record = asRecord(metadata);
  const label = String(record.table_label ?? "").trim();
  if (label) return label;
  const code = String(record.table_code ?? "").trim();
  const name = String(record.table_name ?? "").trim();
  if (code && name && code !== name) return `${code} · ${name}`;
  return code || name || null;
}

async function queueOnRoute(args: {
  auth: AuthContext;
  route: ResolvedPrinterRoute;
  orderId: string | null;
  kitchenTicketId?: string | null;
  idempotencyKey?: string | null;
  printerRole: "receipt" | "kitchen" | "report";
  payloadText: string;
  payloadJson?: JsonRecord;
  metadata?: JsonRecord;
}) {
  const jobs = [];
  for (let copy = 1; copy <= args.route.copies; copy += 1) {
    const job = await enqueuePrintJob({
      auth: args.auth,
      printer: args.route.printer,
      orderId: args.orderId,
      kitchenTicketId: args.kitchenTicketId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
      printerRole: args.printerRole,
      payloadText: args.payloadText,
      payloadJson: args.payloadJson ?? {},
      metadata: {
        ...(args.metadata ?? {}),
        routing_source: args.route.source,
        routing_purpose: args.route.purpose,
        routing_zone_key: args.route.zoneKey || null,
        routing_printer_device_id: args.route.printerDeviceId,
        routing_runtime_device_code: args.route.runtimeDeviceCode,
        copy_number: copy,
        copy_count: args.route.copies
      }
    });
    if (shouldDefer(args.route)) jobs.push(job);
    else jobs.push((await processPrintJob(job.id)) ?? job);
  }
  return jobs;
}

async function loadBranchName(auth: AuthContext, fallback?: string | null) {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("branches")
    .select("name")
    .eq("tenant_id", auth.tenantId!)
    .eq("id", auth.branchId!)
    .maybeSingle<{ name: string | null }>();
  return String(data?.name ?? fallback ?? "Branch POS");
}

function storeTemplateFields(profile: Awaited<ReturnType<typeof loadReceiptStoreProfile>>) {
  const storeName = profile?.display_name || profile?.name || "CpIPOS";
  return {
    store_name: storeName,
    business_name: storeName,
    company_name: profile?.name || storeName,
    store_logo_url: profile?.logo_url,
    logo_url: profile?.logo_url,
    store_address: profile?.company_address,
    address: profile?.company_address,
    store_phone: profile?.contact_phone,
    phone: profile?.contact_phone
  };
}

function storePayload(profile: Awaited<ReturnType<typeof loadReceiptStoreProfile>>): JsonRecord {
  return {
    store_name: profile?.display_name ?? profile?.name ?? null,
    business_name: profile?.display_name ?? profile?.name ?? null,
    company_name: profile?.name ?? null,
    store_logo_url: profile?.logo_url ?? null,
    logo_url: profile?.logo_url ?? null,
    logo: profile?.logo_url ?? null,
    store_address: profile?.company_address ?? null,
    address: profile?.company_address ?? null,
    store_phone: profile?.contact_phone ?? null,
    phone: profile?.contact_phone ?? null,
    store_code: profile?.code ?? null
  };
}

export async function queueRoutedSalesReceipt(args: {
  auth: AuthContext;
  runtimeDeviceCode?: string | null;
  order: {
    id: string;
    order_no: string;
    total_amount: number;
    discount_amount: number;
    notes?: string | null;
    cash_received?: number | null;
    change_amount?: number | null;
    mode_label?: string | null;
  };
  items: ReceiptSnapshotItem[];
  paymentMethod: "cash" | "bank_transfer";
  sellerName?: string | null;
}) {
  const routes = await resolvePrinterRoutes({
    auth: args.auth,
    purpose: "receipt",
    runtimeDeviceCode: args.runtimeDeviceCode,
    legacyRole: "receipt"
  });
  if (routes.length === 0) return [];

  const [storeProfile, sellerName] = await Promise.all([
    loadReceiptStoreProfile(args.auth.tenantId!),
    loadReceiptSellerName(args.auth, args.auth.userId, { seller_name: args.sellerName ?? null })
  ]);
  const branchName = await loadBranchName(args.auth, storeProfile?.display_name ?? storeProfile?.name);
  const jobs = [];
  for (const route of routes) {
    const paidAtIso = new Date().toISOString();
    const payload = renderReceiptTemplate({
      ...storeTemplateFields(storeProfile),
      order_id: args.order.id,
      order_no: args.order.order_no,
      branch_name: branchName,
      cashier_name: sellerName,
      paid_at_iso: paidAtIso,
      currency: "THB",
      items: args.items.map((item) => ({ name: item.product_name, qty: item.quantity, unit_price: item.unit_price, line_total: item.line_total })),
      subtotal: args.order.total_amount + args.order.discount_amount,
      discount_amount: args.order.discount_amount,
      tax_amount: 0,
      total_amount: args.order.total_amount,
      payment_method: args.paymentMethod,
      cash_received: args.order.cash_received ?? null,
      change_amount: args.order.change_amount ?? null,
      mode_label: args.order.mode_label ?? null,
      note: args.order.notes ?? undefined
    }, route.printer.paper_width_mm);
    const receiptHtml = renderReceiptHtml({
      paperWidthMm: route.printer.paper_width_mm,
      storeName: String(storeProfile?.display_name ?? storeProfile?.name ?? branchName),
      branchName,
      storeAddress: storeProfile?.company_address ?? null,
      storePhone: storeProfile?.contact_phone ?? null,
      logoUrl: storeProfile?.logo_url ?? null,
      sellerName,
      orderNo: args.order.order_no,
      modeLabel: args.order.mode_label ?? "หน้าขาย",
      paidAtIso,
      items: args.items.map((item) => ({ name: item.product_name, quantity: item.quantity, unitPrice: item.unit_price, lineTotal: item.line_total, note: item.note ?? null })),
      discountAmount: args.order.discount_amount,
      taxAmount: 0,
      totalAmount: args.order.total_amount,
      paymentMethod: args.paymentMethod,
      cashReceived: args.order.cash_received ?? null,
      changeAmount: args.order.change_amount ?? null,
      note: args.order.notes ?? null
    });
    jobs.push(...await queueOnRoute({
      auth: args.auth,
      route,
      orderId: args.order.id,
      printerRole: "receipt",
      payloadText: payload,
      payloadJson: {
        ...storePayload(storeProfile),
        branch_name: branchName,
        order_id: args.order.id,
        order_no: args.order.order_no,
        items: args.items,
        total_amount: args.order.total_amount,
        discount_amount: args.order.discount_amount,
        cash_received: args.order.cash_received ?? null,
        change_amount: args.order.change_amount ?? null,
        payment_method: args.paymentMethod
      },
      metadata: {
        request_source: "pos_payment",
        paper_width_mm: route.printer.paper_width_mm,
        payload_format: "receipt_html_v1",
        payload_html: receiptHtml
      }
    }));
  }
  return jobs;
}

export async function queueRoutedPaymentNotice(args: {
  auth: AuthContext;
  runtimeDeviceCode?: string | null;
  order: {
    id: string;
    order_no: string;
    total_amount: number;
    discount_amount: number;
    tax_amount?: number | null;
    table_label?: string | null;
    created_at?: string | null;
  };
  items: PaymentNoticeItem[];
  sellerName?: string | null;
  qrDataUri: string;
  accountLabel?: string | null;
  promptPayLabel?: string | null;
}) {
  const routes = await resolvePrinterRoutes({
    auth: args.auth,
    purpose: "payment_slip",
    fallbackPurposes: ["receipt"],
    runtimeDeviceCode: args.runtimeDeviceCode,
    legacyRole: "receipt"
  });
  if (routes.length === 0) return [];

  const [storeProfile, sellerName] = await Promise.all([
    loadReceiptStoreProfile(args.auth.tenantId!),
    loadReceiptSellerName(args.auth, args.auth.userId, { seller_name: args.sellerName ?? null })
  ]);
  const branchName = await loadBranchName(args.auth, storeProfile?.display_name ?? storeProfile?.name);
  const jobs = [];
  for (const route of routes) {
    const html = renderPaymentNoticeHtml({
      paperWidthMm: route.printer.paper_width_mm,
      storeName: String(storeProfile?.display_name ?? storeProfile?.name ?? branchName),
      branchName,
      storeAddress: storeProfile?.company_address ?? null,
      storePhone: storeProfile?.contact_phone ?? null,
      logoUrl: storeProfile?.logo_url ?? null,
      sellerName,
      tableLabel: args.order.table_label ?? null,
      orderNo: args.order.order_no,
      createdAtIso: args.order.created_at ?? new Date().toISOString(),
      items: args.items,
      discountAmount: args.order.discount_amount,
      taxAmount: args.order.tax_amount ?? 0,
      totalAmount: args.order.total_amount,
      accountLabel: args.accountLabel ?? null,
      promptPayLabel: args.promptPayLabel ?? null,
      qrDataUri: args.qrDataUri
    });
    jobs.push(...await queueOnRoute({
      auth: args.auth,
      route,
      orderId: args.order.id,
      printerRole: "receipt",
      payloadText: `PAYMENT NOTICE\n${args.order.order_no}\n${args.order.total_amount.toFixed(2)}`,
      payloadJson: {
        ...storePayload(storeProfile),
        branch_name: branchName,
        order_id: args.order.id,
        order_no: args.order.order_no,
        document_type: "payment_notice",
        total_amount: args.order.total_amount,
        qr_data_uri: args.qrDataUri,
        items: args.items
      },
      metadata: {
        request_source: "pos_payment_notice",
        document_type: "payment_notice",
        payment_status: "pending",
        payload_format: "payment_notice_html_v1",
        paper_width_mm: route.printer.paper_width_mm,
        payload_html: html
      }
    }));
  }
  return jobs;
}

export async function queueRoutedKitchenTicketPrint(args: {
  auth: AuthContext;
  kitchenTicketId: string;
  runtimeDeviceCode?: string | null;
  forceReprint?: boolean;
}) {
  const supabase = getSupabaseServiceClient();
  if (!args.forceReprint) {
    const { data: existing, error: existingError } = await supabase
      .from("print_jobs")
      .select("id,tenant_id,branch_id,order_id,kitchen_ticket_id,idempotency_key,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,printed_at,failed_at,created_at,updated_at,metadata")
      .eq("tenant_id", args.auth.tenantId!)
      .eq("branch_id", args.auth.branchId!)
      .eq("kitchen_ticket_id", args.kitchenTicketId)
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    if ((existing ?? []).length > 0) return existing;
  }

  const ticketQuery = (selectColumns: string) => supabase
    .from("kitchen_tickets")
    .select(selectColumns)
    .eq("tenant_id", args.auth.tenantId!)
    .eq("branch_id", args.auth.branchId!)
    .eq("id", args.kitchenTicketId)
    .maybeSingle();

  const ticketResult = await ticketQuery(KITCHEN_TICKET_PRINT_SELECT_WITH_ROUND);
  let ticket = ticketResult.data as Record<string, unknown> | null;
  let ticketError = ticketResult.error;
  if (isMissingRoundNoError(ticketError)) {
    const fallback = await ticketQuery(KITCHEN_TICKET_PRINT_SELECT_BASE);
    ticket = fallback.data && typeof fallback.data === "object" ? { ...(fallback.data as Record<string, unknown>), round_no: null } : null;
    ticketError = fallback.error;
  }

  const { data: items, error: itemsError } = await supabase
    .from("kitchen_ticket_items")
    .select("id,product_name,quantity,notes,action,metadata")
    .eq("tenant_id", args.auth.tenantId!)
    .eq("branch_id", args.auth.branchId!)
    .eq("kitchen_ticket_id", args.kitchenTicketId)
    .order("created_at", { ascending: true });
  if (ticketError) throw new Error(ticketError.message);
  if (itemsError) throw new Error(itemsError.message);
  if (!ticket) throw new Error("kitchen_ticket_not_found");

  const zoneRelation = (ticket as { kitchen_zones?: unknown }).kitchen_zones;
  const zone = Array.isArray(zoneRelation) ? zoneRelation[0] : zoneRelation;
  const zoneRecord = zone && typeof zone === "object" ? zone as { zone_code?: string | null; zone_name?: string | null } : {};
  const zoneCode = String(zoneRecord.zone_code ?? "").trim().toUpperCase();
  if (!zoneCode) throw new Error("kitchen_ticket_zone_missing");

  const routes = await resolvePrinterRoutes({
    auth: args.auth,
    purpose: "kitchen",
    zoneKey: zoneCode,
    runtimeDeviceCode: args.runtimeDeviceCode,
    legacyRole: "kitchen"
  });
  if (routes.length === 0) return [];

  const [branchName, storeProfile] = await Promise.all([
    loadBranchName(args.auth),
    loadReceiptStoreProfile(args.auth.tenantId!)
  ]);
  const storeName = String(storeProfile?.display_name ?? storeProfile?.name ?? "CpIPOS");
  const row = ticket as unknown as {
    id: string;
    order_id: string;
    zone_id: string;
    event_type: string;
    order_no: string;
    order_type: string;
    table_id: string | null;
    queue_no: number | null;
    round_no: number | null;
    created_at: string;
    metadata: JsonRecord | null;
  };
  const tableLabel = kitchenTableLabel(row.metadata);
  const printJobs = [];
  for (const route of routes) {
    const paperWidth = route.printer.paper_width_mm === 80 ? 80 : 58;
    const html = renderKitchenTicketHtml({
      storeName,
      branchName,
      zoneName: String(zoneRecord.zone_name ?? zoneCode),
      zoneCode,
      queueNo: Number(row.queue_no ?? 0),
      roundNo: Number(row.round_no ?? 1),
      orderNo: row.order_no,
      orderType: row.order_type,
      tableLabel,
      ticketId: row.id,
      eventType: row.event_type,
      createdAtIso: row.created_at,
      paperWidthMm: paperWidth,
      items: (items ?? []).map((item) => ({
        name: String(item.product_name ?? "Item"),
        quantity: Number(item.quantity ?? 0),
        notes: item.notes ? String(item.notes) : null,
        action: item.action ? String(item.action) : null
      }))
    });
    printJobs.push(...await queueOnRoute({
      auth: args.auth,
      route,
      orderId: row.order_id,
      kitchenTicketId: row.id,
      idempotencyKey: args.forceReprint ? null : `kitchen:${row.id}:${route.printer.id}`,
      printerRole: "kitchen",
      payloadText: `[${zoneCode}] ${row.order_no} โต๊ะ ${tableLabel ?? "-"} คิว ${row.queue_no ?? "-"} รอบ ${row.round_no ?? 1}`,
      payloadJson: {
        ...storePayload(storeProfile),
        document_type: "kitchen_ticket",
        kitchen_ticket_id: row.id,
        zone_code: zoneCode,
        table_id: row.table_id,
        table_label: tableLabel,
        queue_no: row.queue_no,
        round_no: row.round_no,
        items: items ?? []
      },
      metadata: {
        request_source: args.forceReprint ? "kitchen_ticket_reprint" : "kitchen_ticket_dispatch",
        document_type: "kitchen_ticket",
        kitchen_ticket_id: row.id,
        zone_id: row.zone_id,
        zone_code: zoneCode,
        table_id: row.table_id,
        table_label: tableLabel,
        queue_no: row.queue_no,
        round_no: row.round_no,
        event_type: row.event_type,
        payload_format: "kitchen_ticket_html_v1",
        paper_width_mm: paperWidth,
        payload_html: html
      }
    }));
  }
  return printJobs;
}

export async function queueRoutedKitchenFallback(args: {
  auth: AuthContext;
  orderId: string;
  runtimeDeviceCode?: string | null;
  action?: "new" | "reprint";
}) {
  const supabase = getSupabaseServiceClient();
  const [{ data: order, error: orderError }, { data: items, error: itemsError }] = await Promise.all([
    supabase
      .from("orders")
      .select("id,order_no")
      .eq("tenant_id", args.auth.tenantId!)
      .eq("branch_id", args.auth.branchId!)
      .eq("id", args.orderId)
      .maybeSingle<{ id: string; order_no: string }>(),
    supabase
      .from("order_items")
      .select("id,product_id,name,quantity,notes")
      .eq("tenant_id", args.auth.tenantId!)
      .eq("branch_id", args.auth.branchId!)
      .eq("order_id", args.orderId)
  ]);
  if (orderError) throw new Error(orderError.message);
  if (itemsError) throw new Error(itemsError.message);
  if (!order) throw new Error("order_not_found");
  if (!items?.length) return [];

  const routes = await resolvePrinterRoutes({
    auth: args.auth,
    purpose: "kitchen",
    runtimeDeviceCode: args.runtimeDeviceCode,
    legacyRole: "kitchen"
  });
  if (routes.length === 0) return [];

  const branchName = await loadBranchName(args.auth);
  const jobs = [];
  for (const route of routes) {
    const payload = renderKitchenTicketTemplate({
      order_id: order.id,
      order_no: order.order_no,
      branch_name: branchName,
      station: "ครัว",
      ticket_at_iso: new Date().toISOString(),
      items: items.map((item) => ({
        name: String(item.name ?? item.product_id ?? "Item"),
        qty: Number(item.quantity ?? 0),
        note: item.notes ? String(item.notes) : undefined
      }))
    }, route.printer.paper_width_mm);
    jobs.push(...await queueOnRoute({
      auth: args.auth,
      route,
      orderId: order.id,
      printerRole: "kitchen",
      payloadText: payload,
      payloadJson: {
        order_id: order.id,
        order_no: order.order_no,
        station: "ครัว",
        items: items.map((item) => ({ id: item.id, product_id: item.product_id, name: item.name, quantity: item.quantity, notes: item.notes }))
      },
      metadata: {
        request_source: "kitchen_branch_fallback",
        fallback_no_kitchen_zones: true,
        kitchen_action: args.action ?? "new",
        paper_width_mm: route.printer.paper_width_mm
      }
    }));
  }
  return jobs;
}

export async function queueRoutedReceiptReprint(args: {
  auth: AuthContext;
  orderId: string;
  runtimeDeviceCode?: string | null;
  receiptHtml?: string | null;
}) {
  const supabase = getSupabaseServiceClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,order_no,subtotal,total_amount,grand_total,discount_amount,tax_total,notes,created_by,payment_completed_at,created_at,cash_received,change_amount")
    .eq("tenant_id", args.auth.tenantId!)
    .eq("branch_id", args.auth.branchId!)
    .eq("id", args.orderId)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error("order_not_found");

  const [itemsResult, paymentsResult, branchResult, storeProfile] = await Promise.all([
    supabase.from("order_items").select("product_id,name,quantity,unit_price,line_total,notes").eq("tenant_id", args.auth.tenantId!).eq("branch_id", args.auth.branchId!).eq("order_id", args.orderId),
    supabase.from("payments").select("method,amount,created_at").eq("tenant_id", args.auth.tenantId!).eq("branch_id", args.auth.branchId!).eq("order_id", args.orderId).order("created_at", { ascending: false }),
    supabase.from("branches").select("name").eq("tenant_id", args.auth.tenantId!).eq("id", args.auth.branchId!).maybeSingle<{ name: string | null }>(),
    loadReceiptStoreProfile(args.auth.tenantId!)
  ]);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (branchResult.error) throw new Error(branchResult.error.message);

  const primaryPayment = (paymentsResult.data ?? [])[0] as { method?: string | null } | undefined;
  const paymentMethod: PaymentMethod = primaryPayment?.method === "bank_transfer" ? "bank_transfer" : "cash";
  const routes = await resolvePrinterRoutes({
    auth: args.auth,
    purpose: "reprint",
    fallbackPurposes: ["receipt"],
    runtimeDeviceCode: args.runtimeDeviceCode,
    legacyRole: "receipt"
  });
  if (routes.length === 0) throw new Error("receipt_printer_not_configured");

  const totalAmount = Number(order.grand_total ?? order.total_amount ?? 0);
  const receiptItems = (itemsResult.data ?? []).map((item) => ({
    name: String(item.name ?? item.product_id ?? "Item"),
    qty: Number(item.quantity ?? 0),
    unit_price: Number(item.unit_price ?? 0),
    line_total: Number(item.line_total ?? 0),
    note: item.notes ? String(item.notes) : null
  }));
  const branchName = String(branchResult.data?.name ?? storeProfile?.display_name ?? "Branch POS");
  const paidAtIso = String(order.payment_completed_at ?? order.created_at ?? new Date().toISOString());
  const sellerName = await loadReceiptSellerName(args.auth, String(order.created_by ?? args.auth.userId));
  const jobs = [];
  for (const route of routes) {
    const payload = renderReceiptTemplate({
      ...storeTemplateFields(storeProfile),
      order_id: args.orderId,
      order_no: String(order.order_no),
      branch_name: branchName,
      cashier_name: sellerName,
      paid_at_iso: paidAtIso,
      currency: "THB",
      items: receiptItems.length > 0 ? receiptItems : [{ name: "Reprint copy", qty: 1, unit_price: 0, line_total: 0 }],
      subtotal: Number(order.subtotal ?? order.total_amount ?? 0),
      discount_amount: Number(order.discount_amount ?? 0),
      tax_amount: Number(order.tax_total ?? 0),
      total_amount: totalAmount,
      payment_method: paymentMethod,
      cash_received: Number(order.cash_received ?? totalAmount),
      change_amount: Number(order.change_amount ?? 0),
      note: `Reprint for order ${order.order_no}`
    }, route.printer.paper_width_mm);
    const fallbackHtml = renderReceiptHtml({
      paperWidthMm: route.printer.paper_width_mm,
      storeName: String(storeProfile?.display_name ?? storeProfile?.name ?? branchName),
      branchName,
      storeAddress: storeProfile?.company_address ?? null,
      storePhone: storeProfile?.contact_phone ?? null,
      logoUrl: storeProfile?.logo_url ?? null,
      sellerName,
      orderNo: String(order.order_no),
      modeLabel: "ใบเสร็จย้อนหลัง",
      paidAtIso,
      items: receiptItems.map((item) => ({ name: item.name, quantity: item.qty, unitPrice: item.unit_price, lineTotal: item.line_total, note: item.note })),
      discountAmount: Number(order.discount_amount ?? 0),
      taxAmount: Number(order.tax_total ?? 0),
      totalAmount,
      paymentMethod,
      cashReceived: Number(order.cash_received ?? totalAmount),
      changeAmount: Number(order.change_amount ?? 0),
      note: order.notes ? String(order.notes) : null,
      reprint: true
    });
    jobs.push(...await queueOnRoute({
      auth: args.auth,
      route,
      orderId: args.orderId,
      printerRole: "receipt",
      payloadText: payload,
      payloadJson: { ...storePayload(storeProfile), branch_name: branchName, order_id: args.orderId, order_no: String(order.order_no), items: receiptItems },
      metadata: {
        request_source: "receipt_history_reprint",
        reprint: true,
        paper_width_mm: route.printer.paper_width_mm,
        payload_format: "receipt_html_v1",
        payload_html: args.receiptHtml?.trim() || fallbackHtml
      }
    }));
  }
  return { mode: "routed_reprint" as const, fallback_to_browser_print: false, jobs };
}

function money(value: number) {
  return value.toFixed(2);
}

function shiftReportText(args: {
  paperWidthMm: 58 | 80;
  branchName: string;
  shiftId: string;
  openedAt: string | null;
  closedAt: string | null;
  openingCash: number;
  expectedCash: number;
  actualCash: number;
  orderCount: number;
  salesTotal: number;
}) {
  const width = args.paperWidthMm === 58 ? 32 : 42;
  const divider = "-".repeat(width);
  const row = (label: string, value: string) => {
    const safeValue = value.slice(0, Math.max(1, width - 2));
    const room = Math.max(1, width - label.length - safeValue.length);
    return `${label}${" ".repeat(room)}${safeValue}`.slice(0, width);
  };
  return [
    "CpIPOS",
    args.branchName.slice(0, width),
    "SHIFT CLOSE REPORT",
    divider,
    row("Shift", args.shiftId.slice(0, 12)),
    row("Open", args.openedAt ? new Date(args.openedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-"),
    row("Close", args.closedAt ? new Date(args.closedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-"),
    divider,
    row("Orders", String(args.orderCount)),
    row("Sales", money(args.salesTotal)),
    row("Opening cash", money(args.openingCash)),
    row("Expected cash", money(args.expectedCash)),
    row("Actual cash", money(args.actualCash)),
    row("Variance", money(args.actualCash - args.expectedCash)),
    divider,
    ""
  ].join("\n");
}

export async function queueRoutedShiftReport(args: {
  auth: AuthContext;
  shiftId: string;
  runtimeDeviceCode?: string | null;
}) {
  const supabase = getSupabaseServiceClient();
  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("id,opening_cash,expected_cash,actual_cash,opened_at,closed_at")
    .eq("tenant_id", args.auth.tenantId!)
    .eq("branch_id", args.auth.branchId!)
    .eq("id", args.shiftId)
    .maybeSingle();
  if (shiftError) throw new Error(shiftError.message);
  if (!shift) throw new Error("shift_not_found");

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id,total_amount,grand_total,status")
    .eq("tenant_id", args.auth.tenantId!)
    .eq("branch_id", args.auth.branchId!)
    .eq("shift_id", args.shiftId);
  if (ordersError) throw new Error(ordersError.message);
  const completed = (orders ?? []).filter((order) => order.status === "completed");
  const salesTotal = completed.reduce((sum, order) => sum + Number(order.grand_total ?? order.total_amount ?? 0), 0);
  const branchName = await loadBranchName(args.auth);

  let routes = await resolvePrinterRoutes({
    auth: args.auth,
    purpose: "shift_report",
    fallbackPurposes: ["receipt"],
    runtimeDeviceCode: args.runtimeDeviceCode,
    legacyRole: "report"
  });
  if (routes.length === 0) {
    routes = await resolvePrinterRoutes({ auth: args.auth, purpose: "receipt", runtimeDeviceCode: args.runtimeDeviceCode, legacyRole: "receipt" });
  }
  if (routes.length === 0) return [];

  const jobs = [];
  for (const route of routes) {
    const payload = shiftReportText({
      paperWidthMm: route.printer.paper_width_mm,
      branchName,
      shiftId: args.shiftId,
      openedAt: shift.opened_at,
      closedAt: shift.closed_at,
      openingCash: Number(shift.opening_cash ?? 0),
      expectedCash: Number(shift.expected_cash ?? 0),
      actualCash: Number(shift.actual_cash ?? 0),
      orderCount: completed.length,
      salesTotal
    });
    jobs.push(...await queueOnRoute({
      auth: args.auth,
      route,
      orderId: null,
      printerRole: "report",
      payloadText: payload,
      metadata: { request_source: "shift_close", shift_id: args.shiftId, paper_width_mm: route.printer.paper_width_mm }
    }));
  }
  return jobs;
}

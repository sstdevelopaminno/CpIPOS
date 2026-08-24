import { fail, ok } from "@/lib/http";
import { resolveRestaurantQrKitchenFlags } from "@/lib/restaurant-qr-profile";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { PosGuardError } from "@/lib/pos-session-guard";
import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

type Severity = "green" | "yellow" | "red";

type TimelineRow = {
  id: string;
  table_id: string;
  table_session_id: string;
  qr_session_id: string | null;
  client_session_id: string | null;
  client_id: string | null;
  event_type: string;
  severity: Severity;
  request_id: string | null;
  submission_id: string | null;
  order_id: string | null;
  item_count: number | null;
  amount: number | null;
  success: boolean | null;
  status_code: number | null;
  error_code: string | null;
  duration_ms: number | null;
  device_brand: string | null;
  device_model: string | null;
  device_class: string | null;
  os_name: string | null;
  os_version: string | null;
  browser_name: string | null;
  browser_version: string | null;
  device_summary: string | null;
  payload: Record<string, unknown> | null;
  event_at: string;
};

type SummaryRow = {
  id: string;
  event_type: string;
  severity: Severity;
  client_id: string | null;
  table_session_id: string;
  event_at: string;
};

type ClientRow = {
  id: string;
  table_id: string;
  table_session_id: string;
  client_id: string;
  device_brand: string | null;
  device_model: string | null;
  device_class: string | null;
  os_name: string | null;
  os_version: string | null;
  browser_name: string | null;
  browser_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
  scan_count: number;
  submit_attempt_count: number;
  submit_success_count: number;
  submit_failure_count: number;
  duplicate_count: number;
};

type KitchenTicketRow = {
  id: string;
  order_id: string;
  zone_id: string | null;
  event_type: string | null;
  status: string | null;
  queue_no: number | null;
  round_no: number | null;
  created_at: string;
};

type PrintJobRow = {
  id: string;
  kitchen_ticket_id: string | null;
  printer_id: string | null;
  status: string;
  idempotency_key: string | null;
  retry_count: number | null;
  last_error: string | null;
  printed_at: string | null;
  failed_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type PrinterRow = { id: string; printer_name: string | null };

type PrintJobAudit = PrintJobRow & {
  printer_name: string | null;
  request_source: string | null;
  copy_number: number | null;
  copy_count: number | null;
  intentional_reprint: boolean;
  duplicate_suspected: boolean;
};

type PrintAudit = {
  ticket_count: number;
  print_job_count: number;
  printed_count: number;
  pending_count: number;
  failed_count: number;
  intentional_reprint_count: number;
  duplicate_suspected_count: number;
  tickets: Array<KitchenTicketRow & { jobs: PrintJobAudit[] }>;
};

const EVENT_SELECT = "id,table_id,table_session_id,qr_session_id,client_session_id,client_id,event_type,severity,request_id,submission_id,order_id,item_count,amount,success,status_code,error_code,duration_ms,device_brand,device_model,device_class,os_name,os_version,browser_name,browser_version,device_summary,payload,event_at";
const TERMINAL_EVENT_TYPES = ["submit_success", "submit_failure", "duplicate_blocked"];
const SUMMARY_LIMIT = 5000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function itemProductIds(payload: Record<string, unknown>) {
  const ids = new Set<string>();
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const raw of items) {
    const item = asRecord(raw);
    const id = String(item.product_id ?? "").trim();
    if (id) ids.add(id);
  }
  const direct = String(payload.product_id ?? "").trim();
  if (direct) ids.add(direct);
  return ids;
}

function enrichPayloadItems(payload: Record<string, unknown>, products: Map<string, { name: string; sku: string | null }>) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const enriched = items.map((raw) => {
    const item = asRecord(raw);
    const productId = String(item.product_id ?? "").trim();
    const product = products.get(productId);
    return {
      ...item,
      product_id: productId || null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null
    };
  });
  const directProductId = String(payload.product_id ?? "").trim();
  const directProduct = products.get(directProductId);
  return {
    ...payload,
    ...(enriched.length ? { items: enriched } : {}),
    ...(directProductId ? { product_id: directProductId, product_name: directProduct?.name ?? null, product_sku: directProduct?.sku ?? null } : {})
  };
}

function toPositiveInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function detectConcurrentAttempts(attempts: SummaryRow[]) {
  const result = new Map<string, number>();
  const byTable = new Map<string, SummaryRow[]>();
  for (const attempt of attempts) {
    const list = byTable.get(attempt.table_session_id) ?? [];
    list.push(attempt);
    byTable.set(attempt.table_session_id, list);
  }
  for (const list of byTable.values()) {
    list.sort((left, right) => Date.parse(left.event_at) - Date.parse(right.event_at));
    for (let index = 0; index < list.length; index += 1) {
      const current = list[index];
      const at = Date.parse(current.event_at);
      const clients = new Set<string>();
      if (current.client_id) clients.add(current.client_id);
      for (let left = index - 1; left >= 0; left -= 1) {
        if (at - Date.parse(list[left].event_at) > 3000) break;
        if (list[left].client_id) clients.add(list[left].client_id!);
      }
      for (let right = index + 1; right < list.length; right += 1) {
        if (Date.parse(list[right].event_at) - at > 3000) break;
        if (list[right].client_id) clients.add(list[right].client_id!);
      }
      result.set(current.id, clients.size);
    }
  }
  return result;
}

function buildPrintAudits(args: {
  orderIds: string[];
  tickets: KitchenTicketRow[];
  jobs: PrintJobRow[];
  printers: PrinterRow[];
}) {
  const printerNames = new Map(args.printers.map((printer) => [printer.id, printer.printer_name]));
  const jobsByTicket = new Map<string, PrintJobRow[]>();
  for (const job of args.jobs) {
    if (!job.kitchen_ticket_id) continue;
    const list = jobsByTicket.get(job.kitchen_ticket_id) ?? [];
    list.push(job);
    jobsByTicket.set(job.kitchen_ticket_id, list);
  }

  const duplicateJobIds = new Set<string>();
  for (const [ticketId, ticketJobs] of jobsByTicket) {
    const byPrinter = new Map<string, PrintJobRow[]>();
    for (const job of ticketJobs) {
      const key = job.printer_id ?? "no-printer";
      const list = byPrinter.get(key) ?? [];
      list.push(job);
      byPrinter.set(key, list);
    }
    for (const printerJobs of byPrinter.values()) {
      const normalJobs = printerJobs.filter((job) => String(asRecord(job.metadata).request_source ?? "") !== "kitchen_ticket_reprint");
      const expectedCopies = Math.max(1, ...normalJobs.map((job) => Number(asRecord(job.metadata).copy_count ?? 1)).filter(Number.isFinite));
      if (normalJobs.length <= expectedCopies) continue;
      const byCopy = new Map<number, PrintJobRow[]>();
      for (const job of normalJobs) {
        const copyNumber = Math.max(1, Math.trunc(Number(asRecord(job.metadata).copy_number ?? 1)));
        const list = byCopy.get(copyNumber) ?? [];
        list.push(job);
        byCopy.set(copyNumber, list);
      }
      for (const sameCopyJobs of byCopy.values()) {
        if (sameCopyJobs.length > 1) sameCopyJobs.forEach((job) => duplicateJobIds.add(job.id));
      }
      if (normalJobs.length > expectedCopies && duplicateJobIds.size === 0) {
        normalJobs.slice(expectedCopies).forEach((job) => duplicateJobIds.add(job.id));
      }
    }
    void ticketId;
  }

  const ticketsByOrder = new Map<string, Array<KitchenTicketRow & { jobs: PrintJobAudit[] }>>();
  for (const ticket of args.tickets) {
    const auditedJobs = (jobsByTicket.get(ticket.id) ?? []).map<PrintJobAudit>((job) => {
      const metadata = asRecord(job.metadata);
      const requestSource = String(metadata.request_source ?? "").trim() || null;
      const copyNumberRaw = Number(metadata.copy_number ?? NaN);
      const copyCountRaw = Number(metadata.copy_count ?? NaN);
      return {
        ...job,
        printer_name: job.printer_id ? printerNames.get(job.printer_id) ?? null : null,
        request_source: requestSource,
        copy_number: Number.isFinite(copyNumberRaw) ? Math.trunc(copyNumberRaw) : null,
        copy_count: Number.isFinite(copyCountRaw) ? Math.trunc(copyCountRaw) : null,
        intentional_reprint: requestSource === "kitchen_ticket_reprint",
        duplicate_suspected: duplicateJobIds.has(job.id)
      };
    });
    const list = ticketsByOrder.get(ticket.order_id) ?? [];
    list.push({ ...ticket, jobs: auditedJobs });
    ticketsByOrder.set(ticket.order_id, list);
  }

  const result = new Map<string, PrintAudit>();
  for (const orderId of args.orderIds) {
    const tickets = ticketsByOrder.get(orderId) ?? [];
    const jobs = tickets.flatMap((ticket) => ticket.jobs);
    result.set(orderId, {
      ticket_count: tickets.length,
      print_job_count: jobs.length,
      printed_count: jobs.filter((job) => String(job.status).toLowerCase() === "printed").length,
      pending_count: jobs.filter((job) => ["pending", "claimed", "processing", "retrying"].includes(String(job.status).toLowerCase())).length,
      failed_count: jobs.filter((job) => String(job.status).toLowerCase() === "failed").length,
      intentional_reprint_count: jobs.filter((job) => job.intentional_reprint).length,
      duplicate_suspected_count: jobs.filter((job) => job.duplicate_suspected).length,
      tickets
    });
  }
  return result;
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const role = String(auth.branchRole ?? "").trim().toLowerCase();
    if (role !== "owner" && role !== "manager") return fail("forbidden", "Owner or manager permission is required.", 403);

    const flags = resolveRestaurantQrKitchenFlags({ tenantId: auth.tenantId, branchId: auth.branchId });
    if (!flags.qr_pos_review_required) return fail("table_qr_timeline_not_enabled", "QR order timeline is enabled only for this rollout branch.", 404);

    const url = new URL(request.url);
    const hoursRaw = Number(url.searchParams.get("hours") ?? 24);
    const hours = [12, 24, 48, 168].includes(hoursRaw) ? hoursRaw : 24;
    const tableId = String(url.searchParams.get("table_id") ?? "").trim();
    const severity = String(url.searchParams.get("severity") ?? "").trim();
    const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
    const pageSize = toPositiveInt(url.searchParams.get("page_size"), 50, 20, 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const supabase = getRoutedSupabaseServiceClient();

    let eventQuery = supabase
      .from("table_qr_timeline_events")
      .select(EVENT_SELECT, { count: "exact" })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .gte("event_at", cutoff)
      .order("event_at", { ascending: false })
      .range(from, to);
    let summaryQuery = supabase
      .from("table_qr_timeline_events")
      .select("id,event_type,severity,client_id,table_session_id,event_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .gte("event_at", cutoff)
      .order("event_at", { ascending: false })
      .limit(SUMMARY_LIMIT);
    if (tableId) {
      eventQuery = eventQuery.eq("table_id", tableId);
      summaryQuery = summaryQuery.eq("table_id", tableId);
    }
    if (severity === "green" || severity === "yellow" || severity === "red") {
      eventQuery = eventQuery.eq("severity", severity);
      summaryQuery = summaryQuery.eq("severity", severity);
    }

    const [eventResult, summaryResult, clientResult] = await Promise.all([
      eventQuery,
      summaryQuery,
      supabase
        .from("table_qr_client_sessions")
        .select("id,table_id,table_session_id,client_id,device_brand,device_model,device_class,os_name,os_version,browser_name,browser_version,first_seen_at,last_seen_at,scan_count,submit_attempt_count,submit_success_count,submit_failure_count,duplicate_count")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .gte("last_seen_at", cutoff)
        .order("last_seen_at", { ascending: false })
        .limit(500)
    ]);
    if (eventResult.error) throw new Error(eventResult.error.message);
    if (summaryResult.error) throw new Error(summaryResult.error.message);
    if (clientResult.error) throw new Error(clientResult.error.message);

    const rows = (eventResult.data ?? []) as unknown as TimelineRow[];
    const summaryRows = (summaryResult.data ?? []) as unknown as SummaryRow[];
    const clients = (clientResult.data ?? []) as unknown as ClientRow[];
    const requestIds = Array.from(new Set(rows.map((row) => row.request_id).filter((id): id is string => Boolean(id))));
    const terminalResult = requestIds.length > 0
      ? await supabase
          .from("table_qr_timeline_events")
          .select(EVENT_SELECT)
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .in("request_id", requestIds)
          .in("event_type", TERMINAL_EVENT_TYPES)
          .order("event_at", { ascending: false })
          .limit(Math.min(600, requestIds.length * 3))
      : { data: [], error: null };
    if (terminalResult.error) throw new Error(terminalResult.error.message);
    const terminalRows = (terminalResult.data ?? []) as unknown as TimelineRow[];
    const terminalByRequest = new Map<string, TimelineRow>();
    for (const row of terminalRows) {
      if (row.request_id && !terminalByRequest.has(row.request_id)) terminalByRequest.set(row.request_id, row);
    }

    const relatedOrderIdByEvent = new Map<string, string | null>();
    for (const row of rows) {
      const terminal = row.request_id ? terminalByRequest.get(row.request_id) : null;
      relatedOrderIdByEvent.set(row.id, row.order_id ?? terminal?.order_id ?? null);
    }
    const tableIds = Array.from(new Set(rows.map((row) => row.table_id).filter(Boolean)));
    const productIds = new Set<string>();
    for (const row of rows) for (const productId of itemProductIds(asRecord(row.payload))) productIds.add(productId);
    const orderIds = Array.from(new Set(Array.from(relatedOrderIdByEvent.values()).filter((id): id is string => Boolean(id))));

    const [tableResult, productResult, ticketResult] = await Promise.all([
      tableIds.length
        ? supabase.from("dining_tables").select("id,table_code,table_name").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).in("id", tableIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.size
        ? supabase.from("products").select("id,sku,name").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).in("id", Array.from(productIds))
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? supabase.from("kitchen_tickets").select("id,order_id,zone_id,event_type,status,queue_no,round_no,created_at").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).in("order_id", orderIds).order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ]);
    if (tableResult.error) throw new Error(tableResult.error.message);
    if (productResult.error) throw new Error(productResult.error.message);
    if (ticketResult.error) throw new Error(ticketResult.error.message);

    const tickets = (ticketResult.data ?? []) as unknown as KitchenTicketRow[];
    const ticketIds = tickets.map((ticket) => ticket.id);
    const jobResult = ticketIds.length
      ? await supabase
          .from("print_jobs")
          .select("id,kitchen_ticket_id,printer_id,status,idempotency_key,retry_count,last_error,printed_at,failed_at,created_at,metadata")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .in("kitchen_ticket_id", ticketIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (jobResult.error) throw new Error(jobResult.error.message);
    const jobs = (jobResult.data ?? []) as unknown as PrintJobRow[];
    const printerIds = Array.from(new Set(jobs.map((job) => job.printer_id).filter((id): id is string => Boolean(id))));
    const printerResult = printerIds.length
      ? await supabase.from("printer_profiles").select("id,printer_name").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).in("id", printerIds)
      : { data: [], error: null };
    if (printerResult.error) throw new Error(printerResult.error.message);

    const tables = new Map((tableResult.data ?? []).map((row: { id: string; table_code: string; table_name: string | null }) => [row.id, row]));
    const products = new Map((productResult.data ?? []).map((row: { id: string; sku: string | null; name: string }) => [row.id, { name: row.name, sku: row.sku }]));
    const printAudits = buildPrintAudits({
      orderIds,
      tickets,
      jobs,
      printers: (printerResult.data ?? []) as unknown as PrinterRow[]
    });

    const attempts = summaryRows.filter((row) => row.event_type === "submit_attempt");
    const concurrentById = detectConcurrentAttempts(attempts);
    const events = rows.map((row) => {
      const terminal = row.event_type === "submit_attempt" && row.request_id ? terminalByRequest.get(row.request_id) : null;
      const ageMs = Date.now() - Date.parse(row.event_at);
      const attemptState = row.event_type !== "submit_attempt"
        ? null
        : terminal?.event_type === "submit_success"
          ? "success"
          : terminal?.event_type === "duplicate_blocked"
            ? "duplicate_blocked"
            : terminal?.event_type === "submit_failure"
              ? "failed"
              : ageMs > 20_000 ? "unresolved" : "waiting";
      const relatedOrderId = relatedOrderIdByEvent.get(row.id) ?? null;
      return {
        ...row,
        related_order_id: relatedOrderId,
        table: tables.get(row.table_id) ?? null,
        payload: enrichPayloadItems(asRecord(row.payload), products),
        attempt_state: attemptState,
        concurrent_clients: concurrentById.get(row.id) ?? 0,
        print_audit: relatedOrderId ? printAudits.get(relatedOrderId) ?? null : null
      };
    });

    const uniqueClients = new Set(clients.map((row) => row.client_id).filter((id) => id && id !== "anonymous"));
    const summary = {
      hours,
      unique_clients: uniqueClients.size,
      scans: clients.reduce((sum, row) => sum + Number(row.scan_count ?? 0), 0),
      submit_attempts: summaryRows.filter((row) => row.event_type === "submit_attempt").length,
      submit_success: summaryRows.filter((row) => row.event_type === "submit_success").length,
      submit_failure: summaryRows.filter((row) => row.event_type === "submit_failure").length,
      duplicate_blocked: summaryRows.filter((row) => row.event_type === "duplicate_blocked").length,
      cancellations: summaryRows.filter((row) => row.event_type === "item_cancelled").length,
      concurrent_attempts: attempts.filter((row) => (concurrentById.get(row.id) ?? 0) > 1).length,
      red_events: summaryRows.filter((row) => row.severity === "red").length,
      yellow_events: summaryRows.filter((row) => row.severity === "yellow").length,
      summary_truncated: summaryRows.length >= SUMMARY_LIMIT
    };
    const total = Number(eventResult.count ?? 0);

    return ok({
      summary,
      events,
      clients,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
        has_previous: page > 1,
        has_next: to + 1 < total
      },
      server_time: new Date().toISOString(),
      retention_days: 7
    });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("table_qr_timeline_failed", error instanceof Error ? error.message : "Unable to load QR timeline.", 500);
  }
}

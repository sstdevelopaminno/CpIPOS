"use client";

import { useEffect, useMemo, useState } from "react";

type Severity = "green" | "yellow" | "red";
type AttemptState = "success" | "duplicate_blocked" | "failed" | "unresolved" | "waiting" | null;

type PrintJobAudit = {
  id: string;
  kitchen_ticket_id: string | null;
  printer_id: string | null;
  printer_name: string | null;
  status: string;
  idempotency_key: string | null;
  retry_count: number | null;
  last_error: string | null;
  printed_at: string | null;
  failed_at: string | null;
  created_at: string;
  request_source: string | null;
  copy_number: number | null;
  copy_count: number | null;
  intentional_reprint: boolean;
  duplicate_suspected: boolean;
};

type KitchenTicketAudit = {
  id: string;
  order_id: string;
  zone_id: string | null;
  event_type: string | null;
  status: string | null;
  queue_no: number | null;
  round_no: number | null;
  created_at: string;
  jobs: PrintJobAudit[];
};

type PrintAudit = {
  ticket_count: number;
  print_job_count: number;
  printed_count: number;
  pending_count: number;
  failed_count: number;
  intentional_reprint_count: number;
  duplicate_suspected_count: number;
  tickets: KitchenTicketAudit[];
};

type TimelineEvent = {
  id: string;
  table_id: string;
  table_session_id: string;
  client_id: string | null;
  event_type: string;
  severity: Severity;
  request_id: string | null;
  submission_id: string | null;
  order_id: string | null;
  related_order_id: string | null;
  item_count: number | null;
  amount: number | null;
  success: boolean | null;
  status_code: number | null;
  error_code: string | null;
  duration_ms: number | null;
  device_summary: string | null;
  payload: Record<string, unknown>;
  event_at: string;
  attempt_state: AttemptState;
  concurrent_clients: number;
  table: { id: string; table_code: string; table_name: string | null } | null;
  print_audit: PrintAudit | null;
};

type ClientRow = {
  id: string;
  client_id: string;
  device_brand: string | null;
  device_model: string | null;
  os_name: string | null;
  browser_name: string | null;
  scan_count: number;
  submit_attempt_count: number;
  submit_success_count: number;
  submit_failure_count: number;
  duplicate_count: number;
  last_seen_at: string;
};

type TimelineBody = {
  data?: {
    summary: {
      hours: number;
      unique_clients: number;
      scans: number;
      submit_attempts: number;
      submit_success: number;
      submit_failure: number;
      duplicate_blocked: number;
      cancellations: number;
      concurrent_attempts: number;
      red_events: number;
      yellow_events: number;
      summary_truncated?: boolean;
    };
    events: TimelineEvent[];
    clients: ClientRow[];
    pagination: {
      page: number;
      page_size: number;
      total: number;
      total_pages: number;
      has_previous: boolean;
      has_next: boolean;
    };
    retention_days: number;
  };
  error?: { message?: string };
};

type ItemDetail = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  note: string | null;
  ingredientIds: string[];
};

const PAGE_SIZE = 50;

const EVENT_LABELS: Record<string, string> = {
  qr_opened: "เปิด / สแกน QR",
  submit_attempt: "กดปุ่มสั่งอาหาร",
  submit_success: "สั่งอาหารสำเร็จ",
  submit_failure: "สั่งอาหารไม่สำเร็จ",
  duplicate_blocked: "กดซ้ำ — ระบบกันไว้",
  review_kitchen_confirming: "POS กำลังยืนยันเข้าครัว",
  review_accepted: "POS รับรายการเข้าครัว",
  review_partially_accepted: "POS รับบางรายการ",
  review_rejected: "POS ปฏิเสธรายการ",
  item_cancelled: "ยกเลิกรายการอาหาร",
  bill_opened: "เปิดบิลโต๊ะ",
  bill_status_changed: "สถานะบิลเปลี่ยน",
  bill_closed: "ปิดบิลโต๊ะ"
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Bangkok"
  }).format(date);
}

function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-5)}`;
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return `฿${new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

function severityClasses(severity: Severity) {
  if (severity === "red") return "border-red-200 bg-red-50 text-red-800";
  if (severity === "yellow") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function severityDot(severity: Severity) {
  if (severity === "red") return "bg-red-500";
  if (severity === "yellow") return "bg-amber-400";
  return "bg-emerald-500";
}

function eventItems(event: TimelineEvent): ItemDetail[] {
  const raw = Array.isArray(event.payload?.items) ? event.payload.items : [];
  const mapped = raw.map((value) => {
    const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const ingredients = Array.isArray(item.selected_ingredient_ids)
      ? item.selected_ingredient_ids.map((id) => String(id ?? "").trim()).filter(Boolean)
      : [];
    return {
      id: String(item.product_id ?? "").trim(),
      name: String(item.product_name ?? item.product_sku ?? item.product_id ?? "รายการ"),
      sku: String(item.product_sku ?? "").trim() || null,
      quantity: Math.max(0, Number(item.quantity ?? 0)),
      note: String(item.note ?? "").trim() || null,
      ingredientIds: ingredients
    };
  }).filter((item) => item.id || item.name);

  if (mapped.length > 0) return mapped;
  const directId = String(event.payload?.product_id ?? "").trim();
  const directName = String(event.payload?.product_name ?? directId).trim();
  if (!directId && !directName) return [];
  return [{
    id: directId,
    name: directName || "รายการ",
    sku: String(event.payload?.product_sku ?? "").trim() || null,
    quantity: Math.max(0, Number(event.item_count ?? event.payload?.quantity ?? 0)),
    note: String(event.payload?.note ?? "").trim() || null,
    ingredientIds: []
  }];
}

function attemptDetail(event: TimelineEvent) {
  if (event.event_type !== "submit_attempt") return null;
  if (event.attempt_state === "success") return "คำขอนี้มีผลลัพธ์สำเร็จ";
  if (event.attempt_state === "duplicate_blocked") return "ตรวจพบคำขอซ้ำ — ระบบไม่สร้างออเดอร์ใหม่";
  if (event.attempt_state === "failed") return "คำขอนี้ส่งไม่สำเร็จ";
  if (event.attempt_state === "unresolved") return "เซิร์ฟเวอร์ได้รับการกด แต่ไม่พบผลลัพธ์ปลายทางภายในเวลาที่กำหนด";
  return "เซิร์ฟเวอร์ได้รับการกดแล้ว — กำลังรอผล";
}

function printBadge(audit: PrintAudit | null) {
  if (!audit || audit.ticket_count === 0) return { label: "ยังไม่มีใบครัว", cls: "border-slate-200 bg-slate-50 text-slate-500" };
  if (audit.duplicate_suspected_count > 0) return { label: `เสี่ยงพิมพ์ซ้ำ ${audit.duplicate_suspected_count}`, cls: "border-red-200 bg-red-50 text-red-700" };
  if (audit.failed_count > 0) return { label: `พิมพ์ล้มเหลว ${audit.failed_count}`, cls: "border-red-200 bg-red-50 text-red-700" };
  if (audit.pending_count > 0) return { label: `รอพิมพ์ ${audit.pending_count}`, cls: "border-amber-200 bg-amber-50 text-amber-800" };
  if (audit.printed_count > 0) return { label: `พิมพ์แล้ว ${audit.printed_count}`, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  return { label: `${audit.ticket_count} ใบครัว`, cls: "border-slate-200 bg-slate-50 text-slate-600" };
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="text-xs font-bold text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-all text-sm font-semibold text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value || "-"}</dd>
    </div>
  );
}

function TimelineEventDetail({ event, onClose }: { event: TimelineEvent; onClose: () => void }) {
  const items = eventItems(event);
  const print = event.print_audit;
  const attempt = attemptDetail(event);

  useEffect(() => {
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-stretch justify-end bg-slate-950/40" role="dialog" aria-modal="true" aria-label="รายละเอียดไทม์ไลน์ QR">
      <button type="button" aria-label="ปิดรายละเอียด" className="absolute inset-0 cursor-default" onClick={onClose} />
      <section className="relative z-10 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${severityDot(event.severity)}`} />
              <h2 className="text-xl font-black text-slate-950">{event.table?.table_code ?? "โต๊ะ ?"} · {EVENT_LABELS[event.event_type] ?? event.event_type}</h2>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-500">{formatDateTime(event.event_at)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">ปิด ✕</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {attempt ? <div className={`mb-4 rounded-xl border px-4 py-3 text-sm font-bold ${event.attempt_state === "failed" || event.attempt_state === "unresolved" ? "border-red-200 bg-red-50 text-red-700" : event.attempt_state === "waiting" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{attempt}</div> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 p-4">
              <h3 className="mb-2 text-sm font-black text-slate-950">หลักฐานการกด / เครื่อง</h3>
              <dl>
                <DetailRow label="เครื่อง / Browser" value={event.device_summary || "ระบบ / POS"} />
                <DetailRow label="Client ID" value={event.client_id ?? "-"} mono />
                <DetailRow label="Request ID" value={event.request_id ?? "-"} mono />
                <DetailRow label="Submission" value={event.submission_id ?? "-"} mono />
                <DetailRow label="Order ID" value={event.related_order_id ?? event.order_id ?? "-"} mono />
                <DetailRow label="พร้อมกัน" value={event.concurrent_clients > 1 ? `${event.concurrent_clients} เครื่องภายใน ~3 วินาที` : "ไม่พบการกดพร้อมกัน"} />
                <DetailRow label="Response" value={event.status_code ? `HTTP ${event.status_code}` : "-"} />
                <DetailRow label="ระยะเวลา" value={event.duration_ms !== null ? `${Math.round(event.duration_ms)} ms` : "-"} />
                <DetailRow label="Error" value={event.error_code ?? "-"} mono />
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200 p-4">
              <h3 className="mb-2 text-sm font-black text-slate-950">สรุปครัว / การพิมพ์</h3>
              <dl>
                <DetailRow label="Kitchen Tickets" value={String(print?.ticket_count ?? 0)} />
                <DetailRow label="Print Jobs" value={String(print?.print_job_count ?? 0)} />
                <DetailRow label="พิมพ์แล้ว" value={String(print?.printed_count ?? 0)} />
                <DetailRow label="รอพิมพ์" value={String(print?.pending_count ?? 0)} />
                <DetailRow label="ล้มเหลว" value={String(print?.failed_count ?? 0)} />
                <DetailRow label="Reprint ตั้งใจ" value={String(print?.intentional_reprint_count ?? 0)} />
                <DetailRow label="สงสัยพิมพ์ซ้ำ" value={String(print?.duplicate_suspected_count ?? 0)} />
              </dl>
              {print?.duplicate_suspected_count ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-black text-red-700">พบ Print Job ที่มีลักษณะซ้ำของ Kitchen Ticket + Printer เดียวกัน กรุณาตรวจสอบก่อนพิมพ์ซ้ำอีกครั้ง</div>
              ) : null}
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-950">รายการอาหารที่เครื่องนี้ส่ง</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{items.length} รายการ</span>
            </div>
            {items.length === 0 ? <p className="mt-4 text-sm font-semibold text-slate-400">เหตุการณ์นี้ไม่มีรายการอาหารใน payload</p> : (
              <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2">เมนู</th><th className="px-3 py-2">SKU / Product ID</th><th className="px-3 py-2 text-center">จำนวน</th><th className="px-3 py-2">หมายเหตุ</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item, index) => (
                      <tr key={`${item.id}-${index}`}>
                        <td className="px-3 py-2 font-black text-slate-900">{item.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{item.sku ?? shortId(item.id)}<div className="mt-0.5 text-[10px] text-slate-400">{item.id}</div></td>
                        <td className="px-3 py-2 text-center text-base font-black tabular-nums">{item.quantity}</td>
                        <td className="px-3 py-2 text-slate-600">{item.note ?? "-"}{item.ingredientIds.length ? <div className="mt-1 text-xs text-slate-400">ตัวเลือก: {item.ingredientIds.map(shortId).join(", ")}</div> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-slate-200 p-4">
            <h3 className="text-sm font-black text-slate-950">ใบครัวและประวัติ Print Job</h3>
            {!print || print.tickets.length === 0 ? <p className="mt-3 text-sm font-semibold text-slate-400">ยังไม่พบ Kitchen Ticket ที่ผูกกับออเดอร์นี้</p> : (
              <div className="mt-3 space-y-3">
                {print.tickets.map((ticket) => (
                  <div key={ticket.id} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                      <span>Ticket {shortId(ticket.id)} · {ticket.event_type ?? "-"}</span>
                      <span>คิว {ticket.queue_no ?? "-"} · รอบ {ticket.round_no ?? "-"} · {ticket.status ?? "-"}</span>
                    </div>
                    {ticket.jobs.length === 0 ? <div className="px-3 py-3 text-sm font-semibold text-amber-700">มีใบครัว แต่ยังไม่พบ Print Job</div> : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left text-xs">
                          <thead className="bg-white text-slate-400"><tr><th className="px-3 py-2">เครื่องพิมพ์</th><th className="px-3 py-2">สถานะ</th><th className="px-3 py-2">เวลา</th><th className="px-3 py-2">Copy</th><th className="px-3 py-2">ประเภท</th><th className="px-3 py-2">Idempotency</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {ticket.jobs.map((job) => (
                              <tr key={job.id} className={job.duplicate_suspected ? "bg-red-50" : ""}>
                                <td className="px-3 py-2 font-bold text-slate-800">{job.printer_name ?? shortId(job.printer_id)}</td>
                                <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 font-black ${job.duplicate_suspected ? "border-red-200 bg-red-100 text-red-700" : String(job.status).toLowerCase() === "printed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : String(job.status).toLowerCase() === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{job.duplicate_suspected ? "สงสัยซ้ำ" : job.status}</span></td>
                                <td className="px-3 py-2 tabular-nums text-slate-600">{formatDateTime(job.printed_at ?? job.failed_at ?? job.created_at)}</td>
                                <td className="px-3 py-2 font-bold">{job.copy_number ?? "-"}/{job.copy_count ?? "-"}</td>
                                <td className="px-3 py-2">{job.intentional_reprint ? <span className="rounded-full bg-blue-50 px-2 py-0.5 font-black text-blue-700">REPRINT ตั้งใจ</span> : job.request_source ?? "dispatch"}</td>
                                <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{job.idempotency_key ?? "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

export function TableQrOrderTimeline() {
  const [hours, setHours] = useState(24);
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [tableSearch, setTableSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NonNullable<TimelineBody["data"]> | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);

  useEffect(() => {
    setPage(1);
  }, [hours, severity]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ hours: String(hours), page: String(page), page_size: String(PAGE_SIZE) });
        if (severity !== "all") params.set("severity", severity);
        const response = await fetch(`/api/pos/table-qr-timeline?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null) as TimelineBody | null;
        if (!response.ok || !body?.data) throw new Error(body?.error?.message || "โหลดไทม์ไลน์ QR ไม่สำเร็จ");
        setData(body.data);
      } catch (loadError) {
        if ((loadError as { name?: string }).name !== "AbortError") setError(loadError instanceof Error ? loadError.message : "โหลดไทม์ไลน์ QR ไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [hours, page, severity]);

  const visibleEvents = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    if (!query) return data?.events ?? [];
    return (data?.events ?? []).filter((event) => {
      const itemText = eventItems(event).map((item) => `${item.name} ${item.sku ?? ""} ${item.id}`).join(" ");
      const haystack = `${event.table?.table_code ?? ""} ${event.table?.table_name ?? ""} ${event.device_summary ?? ""} ${event.client_id ?? ""} ${event.request_id ?? ""} ${itemText}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [data?.events, tableSearch]);

  const summary = data?.summary;
  const pagination = data?.pagination;
  const cards = [
    ["เครื่อง / Browser", summary?.unique_clients ?? 0],
    ["เปิด QR", summary?.scans ?? 0],
    ["กดสั่ง", summary?.submit_attempts ?? 0],
    ["สำเร็จ", summary?.submit_success ?? 0],
    ["ไม่สำเร็จ", summary?.submit_failure ?? 0],
    ["กันกดซ้ำ", summary?.duplicate_blocked ?? 0],
    ["พร้อมกัน", summary?.concurrent_attempts ?? 0],
    ["ยกเลิก", summary?.cancellations ?? 0]
  ] as const;

  return (
    <section className="min-h-full bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-600">FG0003 · 7-Day Audit</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950">ไทม์ไลน์สั่งอาหารจาก QR</h1>
              <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-600">คลิกแต่ละแถวเพื่อดูว่าเครื่องใดส่งเมนูอะไร เวลาใด ผลสำเร็จหรือไม่ พร้อม Kitchen Ticket และประวัติการพิมพ์ รวมถึงการตรวจ Print Job ซ้ำ</p>
            </div>
            <a href="/preview/pos/settings" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">← กลับตั้งค่า</a>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-bold text-slate-500">{label}</div>
              <div className="mt-1 text-2xl font-black tabular-nums text-slate-950">{value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {[12, 24, 48, 168].map((value) => (
            <button key={value} type="button" onClick={() => setHours(value)} className={`rounded-lg px-3 py-2 text-sm font-bold ${hours === value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{value === 168 ? "7 วัน" : value === 24 ? "24 ชม." : `${value} ชม.`}</button>
          ))}
          <span className="mx-1 hidden h-9 w-px bg-slate-200 sm:block" />
          {(["all", "green", "yellow", "red"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setSeverity(value)} className={`rounded-lg px-3 py-2 text-sm font-bold ${severity === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{value === "all" ? "ทุกสี" : value === "green" ? "🟢 ปกติ" : value === "yellow" ? "🟡 เฝ้าดู" : "🔴 ผิดปกติ"}</button>
          ))}
          <input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="ค้นหาในหน้านี้: โต๊ะ / เครื่อง / client / เมนู" className="min-w-[280px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        {summary?.summary_truncated ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">สรุปด้านบนใช้เหตุการณ์ล่าสุดสูงสุด 5,000 รายการเพื่อรักษาความเร็ว ส่วนตารางยังเปิดดูต่อได้ทุกหน้าภายในช่วงเวลาที่เลือก</div> : null}
        {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center font-bold text-slate-500">กำลังโหลดไทม์ไลน์…</div> : null}
        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</div> : null}

        {!loading && !error ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[64vh] overflow-auto">
              <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-900 text-xs font-black uppercase tracking-wide text-white">
                  <tr>
                    <th className="px-4 py-3">เวลา</th>
                    <th className="px-4 py-3">โต๊ะ</th>
                    <th className="px-4 py-3">เหตุการณ์</th>
                    <th className="px-4 py-3">เครื่อง / Client</th>
                    <th className="px-4 py-3">รายการอาหาร</th>
                    <th className="px-4 py-3">ยอด</th>
                    <th className="px-4 py-3">การพิมพ์ครัว</th>
                    <th className="px-4 py-3 text-center">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleEvents.length === 0 ? <tr><td colSpan={8} className="px-4 py-12 text-center font-semibold text-slate-400">ไม่พบเหตุการณ์ในหน้านี้</td></tr> : null}
                  {visibleEvents.map((event) => {
                    const items = eventItems(event);
                    const print = printBadge(event.print_audit);
                    const attempt = attemptDetail(event);
                    return (
                      <tr key={event.id} tabIndex={0} role="button" onClick={() => setSelectedEvent(event)} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") { keyboardEvent.preventDefault(); setSelectedEvent(event); } }} className="cursor-pointer align-top transition hover:bg-blue-50/50 focus:bg-blue-50 focus:outline-none">
                        <td className="whitespace-nowrap px-4 py-3 font-bold tabular-nums text-slate-700">{formatDateTime(event.event_at)}</td>
                        <td className="px-4 py-3"><div className="text-base font-black text-slate-950">{event.table?.table_code ?? "?"}</div><div className="text-xs text-slate-400">{event.table?.table_name ?? ""}</div></td>
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${severityDot(event.severity)}`} /><span className={`rounded-full border px-2 py-1 text-xs font-black ${severityClasses(event.severity)}`}>{EVENT_LABELS[event.event_type] ?? event.event_type}</span></div>{attempt ? <div className="mt-1 max-w-[250px] text-xs font-semibold text-slate-500">{attempt}</div> : null}{event.concurrent_clients > 1 ? <div className="mt-1 text-xs font-black text-amber-700">⚠ พร้อมกัน {event.concurrent_clients} เครื่อง</div> : null}</td>
                        <td className="max-w-[230px] px-4 py-3"><div className="truncate font-bold text-slate-800">{event.device_summary || "ระบบ / POS"}</div><div className="mt-1 font-mono text-[10px] text-slate-400">Client {shortId(event.client_id)}</div><div className="font-mono text-[10px] text-slate-400">Req {shortId(event.request_id)}</div></td>
                        <td className="max-w-[300px] px-4 py-3">{items.length ? <div className="space-y-1">{items.slice(0, 3).map((item, index) => <div key={`${item.id}-${index}`} className="flex justify-between gap-3"><span className="truncate font-semibold text-slate-700">{item.name}</span><strong className="shrink-0 tabular-nums">x{item.quantity}</strong></div>)}{items.length > 3 ? <div className="text-xs font-black text-blue-600">+ อีก {items.length - 3} รายการ</div> : null}</div> : <span className="text-slate-300">-</span>}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-black tabular-nums text-slate-800">{event.amount !== null ? formatMoney(event.amount) : "-"}</td>
                        <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-black ${print.cls}`}>{print.label}</span>{event.print_audit?.intentional_reprint_count ? <div className="mt-1 text-[10px] font-bold text-blue-600">Reprint ตั้งใจ {event.print_audit.intentional_reprint_count}</div> : null}</td>
                        <td className="px-4 py-3 text-center"><button type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setSelectedEvent(event); }} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100">ดูรายละเอียด</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-semibold text-slate-500">ทั้งหมด {pagination?.total ?? 0} เหตุการณ์ · หน้า {pagination?.page ?? page} / {pagination?.total_pages ?? 1} · แสดงสูงสุด {PAGE_SIZE} รายการ/หน้า</div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={!pagination?.has_previous || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">← ก่อนหน้า</button>
                <button type="button" disabled={!pagination?.has_next || loading} onClick={() => setPage((current) => current + 1)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">ถัดไป →</button>
              </div>
            </footer>
          </div>
        ) : null}
      </div>

      {selectedEvent ? <TimelineEventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} /> : null}
    </section>
  );
}

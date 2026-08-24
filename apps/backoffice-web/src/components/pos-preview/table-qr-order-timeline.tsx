"use client";

import { useEffect, useMemo, useState } from "react";

type Severity = "green" | "yellow" | "red";
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
  item_count: number | null;
  amount: number | null;
  success: boolean | null;
  status_code: number | null;
  error_code: string | null;
  duration_ms: number | null;
  device_summary: string | null;
  payload: Record<string, unknown>;
  event_at: string;
  attempt_state: "success" | "duplicate_blocked" | "failed" | "unresolved" | "waiting" | null;
  concurrent_clients: number;
  table: { id: string; table_code: string; table_name: string | null } | null;
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
    };
    events: TimelineEvent[];
    clients: ClientRow[];
    retention_days: number;
  };
  error?: { message?: string };
};

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

function formatDateTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("th-TH", {
    year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(date);
}

function shortId(value: string | null) {
  if (!value) return "-";
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function severityClasses(severity: Severity) {
  if (severity === "red") return "border-red-200 bg-red-50 text-red-800";
  if (severity === "yellow") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function eventItems(event: TimelineEvent) {
  const raw = Array.isArray(event.payload?.items) ? event.payload.items : [];
  return raw.map((value) => {
    const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
      id: String(item.product_id ?? ""),
      name: String(item.product_name ?? item.product_sku ?? item.product_id ?? "รายการ"),
      quantity: Number(item.quantity ?? 0)
    };
  }).filter((item) => item.id || item.name);
}

function attemptDetail(event: TimelineEvent) {
  if (event.event_type !== "submit_attempt") return null;
  if (event.attempt_state === "success") return "คำขอนี้มีผลลัพธ์สำเร็จ";
  if (event.attempt_state === "duplicate_blocked") return "คำขอนี้ถูกตรวจพบว่าซ้ำและไม่ได้สร้างรายการใหม่";
  if (event.attempt_state === "failed") return "คำขอนี้มีผลลัพธ์ไม่สำเร็จ";
  if (event.attempt_state === "unresolved") return "พบการกดส่ง แต่ไม่พบผลลัพธ์ปลายทางภายในเวลาที่กำหนด";
  return "กดส่งแล้ว — กำลังรอผลจากระบบ";
}

export function TableQrOrderTimeline() {
  const [hours, setHours] = useState(24);
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [tableSearch, setTableSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NonNullable<TimelineBody["data"]> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ hours: String(hours), limit: "800" });
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
  }, [hours, severity]);

  const visibleEvents = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    if (!query) return data?.events ?? [];
    return (data?.events ?? []).filter((event) => {
      const haystack = `${event.table?.table_code ?? ""} ${event.table?.table_name ?? ""} ${event.device_summary ?? ""} ${event.client_id ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [data?.events, tableSearch]);

  const summary = data?.summary;
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
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-600">FG0003 · 7-Day Audit</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950">ไทม์ไลน์สั่งอาหารจาก QR</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-600">
                ตรวจว่าเครื่องไหนเปิด QR, กดสั่งรายการอะไร, กดเวลาใด, สำเร็จ/ไม่สำเร็จ/รอผล/ถูกกันซ้ำ รวมถึง POS รับรายการ ยกเลิกสินค้า และเปิด/ปิดบิล ข้อมูลเก็บแบบ Rolling 7 วัน
              </p>
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
            <button key={value} onClick={() => setHours(value)} className={`rounded-lg px-3 py-2 text-sm font-bold ${hours === value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
              {value === 168 ? "7 วัน" : value === 24 ? "24 ชม." : `${value} ชม.`}
            </button>
          ))}
          <span className="mx-1 hidden h-9 w-px bg-slate-200 sm:block" />
          {(["all", "green", "yellow", "red"] as const).map((value) => (
            <button key={value} onClick={() => setSeverity(value)} className={`rounded-lg px-3 py-2 text-sm font-bold ${severity === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>
              {value === "all" ? "ทุกสี" : value === "green" ? "🟢 ปกติ" : value === "yellow" ? "🟡 เฝ้าดู" : "🔴 ผิดปกติ"}
            </button>
          ))}
          <input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="ค้นหาโต๊ะ / เครื่อง / client" className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center font-bold text-slate-500">กำลังโหลดไทม์ไลน์…</div> : null}
        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</div> : null}

        {!loading && !error ? (
          <div className="space-y-3">
            {visibleEvents.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">ไม่พบเหตุการณ์ในช่วงเวลานี้</div> : null}
            {visibleEvents.map((event) => {
              const items = eventItems(event);
              const attempt = attemptDetail(event);
              const device = event.device_summary || (event.client_id ? `Client ${shortId(event.client_id)}` : "ระบบ / POS");
              return (
                <article key={event.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-1 inline-flex h-3 w-3 shrink-0 rounded-full ${event.severity === "red" ? "bg-red-500" : event.severity === "yellow" ? "bg-amber-400" : "bg-emerald-500"}`} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-base font-black text-slate-950">{event.table?.table_code ?? "โต๊ะ ?"}</strong>
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${severityClasses(event.severity)}`}>{EVENT_LABELS[event.event_type] ?? event.event_type}</span>
                          {event.concurrent_clients > 1 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-800">พร้อมกัน {event.concurrent_clients} เครื่อง</span> : null}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-600">{device}</div>
                        <div className="mt-0.5 text-xs text-slate-400">Client {shortId(event.client_id)} · Request {shortId(event.request_id)}</div>
                      </div>
                    </div>
                    <time className="shrink-0 text-sm font-black tabular-nums text-slate-700">{formatDateTime(event.event_at)}</time>
                  </div>

                  {attempt ? <div className={`mt-3 rounded-xl border px-3 py-2 text-sm font-bold ${event.attempt_state === "unresolved" || event.attempt_state === "failed" ? "border-red-200 bg-red-50 text-red-700" : event.attempt_state === "waiting" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{attempt}</div> : null}

                  {items.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((item, index) => <div key={`${item.id}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm"><strong>{item.name}</strong><span className="float-right font-black">x{item.quantity}</span></div>)}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-slate-500">
                    {event.amount !== null ? <span>ยอด ฿{Number(event.amount).toFixed(2)}</span> : null}
                    {event.duration_ms !== null ? <span>เวลา {Math.round(Number(event.duration_ms))} ms</span> : null}
                    {event.status_code !== null ? <span>HTTP {event.status_code}</span> : null}
                    {event.error_code ? <span className="text-red-600">Error: {event.error_code}</span> : null}
                    {event.order_id ? <span>Order {shortId(event.order_id)}</span> : null}
                    {event.submission_id ? <span>Submission {shortId(event.submission_id)}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        <footer className="pb-8 text-center text-xs font-semibold text-slate-400">ข้อมูล Timeline ถูกลบอัตโนมัติเมื่อเกิน {data?.retention_days ?? 7} วัน · ไม่ใช้แทนข้อมูลบัญชี/ใบเสร็จหลัก</footer>
      </div>
    </section>
  );
}

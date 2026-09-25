"use client";

import Image from "next/image";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { PosSubscriptionCenterData } from "@/lib/services/pos-subscription-center-service";

type Tab = "overview" | "renew" | "notice" | "history" | "documents";
type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };
type IconName = "payment" | "refresh" | "store" | "calendar" | "chart" | "bank" | "copy" |
  "crown" | "file" | "check" | "support" | "upload" | "send" | "clock" | "mail" | "phone" |
  "history" | "wallet" | "info";

const LABELS: Record<string, string> = {
  active: "ใช้งานอยู่", trial: "ทดลองใช้งาน", suspended: "ระงับบริการ",
  expired: "หมดอายุ", locked: "ถูกล็อกบริการ", cancelled: "ยกเลิกสัญญา",
  no_contract: "ยังไม่มีสัญญา", pending: "รอตรวจสอบ", under_review: "กำลังตรวจสอบ",
  approved: "อนุมัติแล้ว", rejected: "ปฏิเสธ", cancelled_request: "ยกเลิก"
};

const ICONS: Record<IconName, ReactNode> = {
  payment: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7.5 7.5 0 0 1 18.6 7L20 12M4 12l1.4 5A7.5 7.5 0 0 0 18.5 15" /></>,
  store: <><path d="M3 10h18l-2-6H5l-2 6ZM5 10v10h14V10M9 20v-6h6v6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
  chart: <><path d="M4 20V11l5-4 4 4 7-7M9 20v-9M14 20v-6M20 20v-9" /></>,
  bank: <><path d="m3 9 9-6 9 6H3ZM5 10v9M10 10v9M14 10v9M19 10v9M3 21h18" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  crown: <><path d="m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Z" /></>,
  file: <><path d="M6 2h8l5 5v14H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM14 2v6h5M8 13h8M8 17h8" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></>,
  support: <><path d="M4 14v-2a8 8 0 1 1 16 0v2M4 13H2v5h5v-5H4Zm16 0h2v5h-5v-5h3ZM20 18c0 3-3 4-8 4" /></>,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 17v3h16v-3" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 7 9-7" /></>,
  phone: <><path d="M7 3H4l-1 5c1 6 7 12 13 13l5-1v-3l-5-3-3 3a16 16 0 0 1-6-6l3-3-3-5Z" /></>,
  history: <><path d="M3 11a9 9 0 1 1 2 6M3 4v7h7M12 7v6l4 2" /></>,
  wallet: <><rect x="3" y="6" width="18" height="15" rx="2" /><path d="M3 10h18M7 6V3h11M16 15h2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>
};

function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    className={"shrink-0 " + className}>{ICONS[name]}</svg>;
}

const box = "min-w-0 rounded-2xl border border-[#e2e9f6] bg-white shadow-[0_5px_20px_rgba(23,50,95,0.05)]";
const field = "mt-1.5 block w-full min-w-0 rounded-xl border border-[#d7e2f4] bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";

function formatMoney(number: number | null, currency = "THB") {
  return number == null ? "ยังไม่กำหนดราคา" :
    new Intl.NumberFormat("th-TH", { style: "currency", currency }).format(number);
}
function formatDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" })
    .format(new Date(value));
}
function Quota({ count }: { count: number | null }) {
  return <>{count === null ? "ไม่จำกัด" : new Intl.NumberFormat("th-TH").format(count)}</>;
}
function ToneIcon({ icon, tone = "blue", size = 22 }: {
  icon: IconName; tone?: "blue" | "green" | "purple" | "orange"; size?: number;
}) {
  const tones = { blue: "bg-blue-50 text-blue-600", green: "bg-emerald-50 text-emerald-600",
    purple: "bg-violet-50 text-violet-600", orange: "bg-orange-50 text-orange-600" };
  return <span className={"inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl " + tones[tone]}>
    <Icon name={icon} size={size} /></span>;
}
function StepLabel({ number, children }: { number: number; children: ReactNode }) {
  return <span className="flex items-center gap-2 text-[13px] font-bold text-slate-700">
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e9f2ff] text-sm font-black text-blue-700">
      {number}
    </span>{children}
  </span>;
}
function SummaryCard({ label, value, detail, icon, tone }: {
  label: string; value: ReactNode; detail?: string; icon: IconName;
  tone: "blue" | "green" | "purple" | "orange";
}) {
  return <article className={box + " flex items-start gap-3 px-4 py-4 sm:px-5"}>
    <ToneIcon icon={icon} tone={tone} />
    <div className="min-w-0 pt-0.5">
      <p className="text-xs font-semibold text-[#71809b]">{label}</p>
      <div className="mt-1 break-words text-[19px] font-extrabold leading-snug text-[#14213c]">{value}</div>
      {detail ? <p className="mt-1 text-xs leading-5 text-[#647491]">{detail}</p> : null}
    </div>
  </article>;
}

const tabs: Array<{ key: Tab; label: string; icon: IconName }> = [
  { key: "overview", label: "ภาพรวม", icon: "chart" },
  { key: "renew", label: "ต่ออายุแพ็กเกจ", icon: "wallet" },
  { key: "notice", label: "แจ้งชำระเงิน", icon: "payment" },
  { key: "history", label: "ประวัติ", icon: "history" },
  { key: "documents", label: "เอกสาร", icon: "file" }
];

export function PosSubscriptionCenter({ initial, isOwner }: {
  initial: PosSubscriptionCenterData; isOwner: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const initialPending = initial.requests.find((row) => ["pending", "under_review"].includes(row.status));
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedPackage, setSelectedPackage] = useState(initialPending?.package_id ||
    initial.contract.package_id || initial.packages[0]?.id || "");
  const [interval, setInterval] = useState(initialPending?.billing_interval === "yearly" ||
    (!initialPending && initial.contract.billing_interval === "yearly") ? "yearly" : "monthly");
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState("");
  const [reference, setReference] = useState("");
  const [transferAt, setTransferAt] = useState("");
  const [note, setNote] = useState("");
  const [slip, setSlip] = useState<File | null>(null);
  const [lineOpen, setLineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const requestKey = useRef<string | null>(null);

  const pending = snapshot.requests.find((row) => ["pending", "under_review"].includes(row.status));
  const lastRequest = snapshot.requests[0];
  const demo = snapshot.contract.is_internal_demo;
  const hasBank = Boolean(snapshot.issuer.account_number || snapshot.issuer.promptpay_id);
  const canSubmit = isOwner && !demo && !busy &&
    (!pending || (tab === "notice" && pending.kind === "renewal_intent"));
  const packageRow = useMemo(() =>
    snapshot.packages.find((row) => row.id === selectedPackage), [selectedPackage, snapshot.packages]);
  const cycleLabel = snapshot.contract.billing_interval === "yearly" ? "รายปี" : "รายเดือน";
  const due = packageRow?.id === snapshot.contract.package_id && interval === snapshot.contract.billing_interval
    ? snapshot.contract.amount_per_cycle
    : interval === "yearly" ? packageRow?.yearly_price ?? null : packageRow?.monthly_price ?? null;
  const priceLabel = demo ? "ยกเว้นการเรียกเก็บ" :
    snapshot.contract.package_code === "custom" && snapshot.contract.amount_per_cycle === null
      ? "ตามสัญญา" : formatMoney(snapshot.contract.amount_per_cycle, snapshot.contract.currency);
  const expiryLabel = demo ? "ไม่กำหนดวันหมดอายุ" : formatDate(snapshot.contract.expires_at);
  const dayCount = demo ? "บัญชีภายใน" : snapshot.contract.days_remaining === null ? "ยังไม่กำหนด" :
    snapshot.contract.days_remaining < 0 ? "เกิน " + Math.abs(snapshot.contract.days_remaining) + " วัน" :
    snapshot.contract.days_remaining + " วัน";
  const statusLabel = demo ? "บัญชีทดสอบภายใน" :
    LABELS[snapshot.contract.status] || snapshot.contract.status;

  function changed() {
    requestKey.current = null;
    setError("");
    setMessage("");
  }
  function selectTab(next: Tab) { setTab(next); setError(""); }

  async function reload() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/pos/billing/overview", { cache: "no-store" });
      const json = await response.json() as Envelope<PosSubscriptionCenterData>;
      if (!response.ok || !json.data) throw new Error(json.error?.message || "โหลดข้อมูลไม่สำเร็จ");
      setSnapshot(json.data);
      const open = json.data.requests.find((row) => ["pending", "under_review"].includes(row.status));
      if (open) {
        setSelectedPackage(open.package_id || "");
        setInterval(open.billing_interval === "yearly" ? "yearly" : "monthly");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setRefreshing(false); }
  }

  async function submit(kind: "renewal_intent" | "payment_notice") {
    if (!canSubmit || !packageRow) return;
    if (kind === "payment_notice") {
      if (!hasBank || !slip) { setError("โปรดตรวจสอบบัญชีรับเงินและแนบสลิปก่อนส่ง"); return; }
      if (slip.size > 4 * 1024 * 1024) { setError("สลิปต้องมีขนาดไม่เกิน 4 MB"); return; }
      if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        setError("กรุณาระบุยอดเงินที่โอนจริง"); return;
      }
      if (!transferAt) { setError("กรุณาระบุวันและเวลาที่โอน"); return; }
      if (!payer.trim()) { setError("กรุณาระบุชื่อผู้โอน"); return; }
    }
    if (!requestKey.current) {
      requestKey.current = kind === "payment_notice" && pending?.kind === "renewal_intent"
        ? pending.id : crypto.randomUUID();
    }
    setBusy(true); setError(""); setMessage("");
    const form = new FormData();
    form.set("request_key", requestKey.current);
    form.set("kind", kind);
    form.set("package_id", selectedPackage);
    form.set("billing_interval", interval);
    form.set("note", note);
    if (kind === "payment_notice") {
      form.set("amount_reported", amount);
      form.set("payer_name", payer);
      form.set("transfer_reference", reference);
      form.set("transfer_at", transferAt);
      if (slip) form.set("slip", slip);
    }
    try {
      const response = await fetch("/api/pos/billing/requests", { method: "POST", body: form });
      const json = await response.json() as Envelope<{ id: string; status: string; already_submitted: boolean }>;
      if (!response.ok || !json.data) throw new Error(json.error?.message || "ส่งคำขอไม่สำเร็จ");
      requestKey.current = null;
      setMessage(kind === "payment_notice" ?
        "บันทึกการแจ้งชำระแล้ว รอ IT ตรวจสอบรายการรับเงินจริง" :
        "ส่งคำขอต่ออายุแล้ว กรุณารอ IT ตรวจสอบรายละเอียด");
      selectTab("history");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ส่งคำขอไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function copyAccount() {
    try {
      await navigator.clipboard.writeText(snapshot.issuer.account_number);
      setCopyStatus("คัดลอกแล้ว");
    } catch {
      setCopyStatus("ไม่สามารถคัดลอกได้ กรุณาคัดลอกเลขบัญชีด้วยตนเอง");
    }
  }

  return <section className="h-full w-full overflow-y-auto bg-[#f7faff] px-3 pb-10 pt-5 sm:px-5 xl:px-7">
    <div className="mx-auto max-w-[1540px] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4 pb-1">
        <div className="flex min-w-0 items-center gap-3">
          <ToneIcon icon="payment" size={26} />
          <div className="min-w-0">
            <h1 className="text-[23px] font-black leading-tight tracking-tight text-[#10213d] sm:text-[28px]">
              แพ็กเกจและการชำระเงิน
            </h1>
            <p className="mt-1 text-[13px] text-[#687992]">
              ตรวจสอบแพ็กเกจ ต่ออายุ และแจ้งชำระเงินสำหรับร้านของคุณ
            </p>
          </div>
        </div>
        <button type="button" disabled={refreshing} onClick={() => void reload()}
          className="inline-flex items-center gap-2 rounded-xl border border-[#d9e4f7] bg-white px-4 py-2.5 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:opacity-50">
          <Icon name="refresh" size={16} />{refreshing ? "กำลังรีเฟรช..." : "รีเฟรชข้อมูล"}
        </button>
      </header>

      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
      {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}

      <section aria-label="ข้อมูลแพ็กเกจปัจจุบัน"
        className="grid gap-0 overflow-hidden rounded-2xl border border-[#cadffc] bg-[linear-gradient(115deg,#ebf5ff_0%,#f2f8ff_65%,#e8f4ff_100%)] shadow-[0_5px_20px_rgba(24,80,170,0.04)] sm:grid-cols-2 xl:grid-cols-[1.25fr_1fr_.8fr_.95fr]">
        <div className="flex min-w-0 items-center gap-4 px-5 py-5">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[19px] bg-gradient-to-br from-[#3185fb] to-[#1355da] text-white shadow-lg shadow-blue-100">
            <Icon name="store" size={29} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">รหัสร้าน</p>
            <p className="break-words text-xl font-extrabold text-[#122642]">{snapshot.store.code}</p>
            <p className="mt-1 text-xs text-slate-500">ชื่อร้าน</p>
            <p className="break-words text-sm font-bold text-[#122642]">{snapshot.store.name}</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 border-t border-[#d5e5fa] px-5 py-5 sm:border-l sm:border-t-0">
          <ToneIcon icon="chart" tone="green" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">แพ็กเกจปัจจุบัน</p>
            <p className="break-words text-xl font-black text-[#132641]">{snapshot.contract.package_name}</p>
            <span className="mt-1 inline-flex rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {demo ? "บัญชีทดสอบ / ติดต่อ IT" : cycleLabel}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-center border-t border-[#d5e5fa] px-5 py-5 xl:border-l xl:border-t-0">
          <p className="text-xs font-semibold text-slate-500">สถานะการใช้งาน</p>
          <p className={"mt-1 flex items-center gap-2 text-xl font-extrabold " +
            (["active", "trial"].includes(snapshot.contract.status) || demo ? "text-emerald-600" : "text-amber-700")}>
            <span className="h-2.5 w-2.5 rounded-full bg-current" />{statusLabel}
          </p>
          <p className="mt-1 text-xs text-slate-500">{demo ? "ไม่คิดค่าบริการบัญชีภายใน" :
            snapshot.contract.status === "active" ? "ใช้งานได้ปกติ" : "ตรวจสอบสถานะก่อนทำรายการ"}</p>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-2 border-t border-[#d5e5fa] px-5 py-5 sm:border-l xl:border-t-0">
          <div className="flex items-start gap-2"><Icon name="calendar" size={17} className="mt-0.5 text-blue-600" />
            <div><p className="text-xs text-slate-500">วันที่เริ่มใช้งาน</p>
              <p className="text-sm font-extrabold text-[#152542]">{formatDate(snapshot.contract.started_at)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2"><Icon name="calendar" size={17} className="mt-0.5 text-blue-600" />
            <div><p className="text-xs text-slate-500">วันหมดอายุ</p>
              <p className="text-sm font-extrabold text-[#152542]">{expiryLabel}</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="สรุปข้อมูลแพ็กเกจ" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon="calendar" tone="green" label="วันคงเหลือ" value={dayCount}
          detail={demo ? "ไม่เรียกเก็บแพ็กเกจบัญชีภายใน" :
            snapshot.contract.expires_at ? "ถึงวันที่ " + expiryLabel : "รอข้อมูลวันหมดอายุจาก IT"} />
        <SummaryCard icon="wallet" tone="purple" label="ค่าบริการต่อรอบ" value={priceLabel}
          detail={demo ? "แพ็กเกจ CUSTOM ภายใน" : "รอบชำระ" + cycleLabel} />
        <SummaryCard icon="crown" tone="blue" label="สิทธิ์การใช้งาน" value={
          <span className="text-base">{demo ? "ไม่จำกัด" : "สาขา / เครื่อง / ผู้ใช้"}</span>}
          detail={demo ? "สาขา / เครื่อง / ผู้ใช้งาน" :
            [snapshot.contract.max_branches, snapshot.contract.max_devices, snapshot.contract.max_users]
              .map((n) => n === null ? "ไม่จำกัด" : String(n)).join(" / ")} />
        <SummaryCard icon="file" tone="orange" label="สถานะคำขอ"
          value={<span className="text-[17px]">{pending ? LABELS[pending.status] || pending.status :
            lastRequest ? LABELS[lastRequest.status] || lastRequest.status : "ไม่มีคำขอรอดำเนินการ"}</span>}
          detail={pending ? pending.kind === "renewal_intent" ? "รอการแจ้งชำระหรือ IT ตรวจสอบ" :
            "รอ IT ยืนยันยอดรับเงินจริง" :
            lastRequest ? "รายการล่าสุด " + formatDate(lastRequest.submitted_at) : "ยังไม่มีรายการแจ้งชำระ"} />
      </section>

      {pending ? <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Icon name="info" size={19} className="mt-0.5" />
        <p>มีคำขอแพ็กเกจรอตรวจสอบ ({LABELS[pending.status] || pending.status}) · {pending.kind === "renewal_intent" ?
          "สามารถแจ้งชำระโดยแนบสลิปในคำขอเดิมได้" :
          "ส่งคำขอใหม่ได้หลังตรวจสอบรายการเดิมเสร็จ"}</p>
      </div> : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_365px]">
        <main className="min-w-0 space-y-3">
          <nav aria-label="เมนูแพ็กเกจ" className="flex min-w-0 gap-1 overflow-x-auto border-b border-[#dce5f2]">
            {tabs.map((item) => <button type="button" key={item.key}
              aria-current={tab === item.key ? "page" : undefined}
              onClick={() => selectTab(item.key)}
              className={"inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-3 py-3 text-[13px] font-bold transition " +
                (tab === item.key ? "border-blue-600 text-blue-700" :
                  "border-transparent text-slate-600 hover:bg-blue-50 hover:text-blue-700")}>
              <Icon name={item.icon} size={17} />{item.label}
            </button>)}
          </nav>

          {tab === "overview" ? <section className={box + " space-y-4 p-5"}>
            <div className="flex items-center gap-3"><ToneIcon icon="chart" />
              <div><h2 className="text-lg font-extrabold text-slate-900">ภาพรวมการใช้งาน</h2>
                <p className="text-xs text-slate-500">แพ็กเกจของร้านและสถานะที่บันทึกในฐานข้อมูลกลาง</p></div>
            </div>
            <div className="grid gap-3 rounded-xl bg-[#f4f8ff] p-4 sm:grid-cols-2">
              {[
                ["รหัสร้าน", snapshot.store.code], ["ชื่อร้าน", snapshot.store.name],
                ["แพ็กเกจ", snapshot.contract.package_name], ["รอบชำระ", cycleLabel],
                ["สถานะบริการ", statusLabel], ["วันหมดอายุ", expiryLabel]
              ].map(([label, value]) => <div key={label}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="break-words text-sm font-bold text-slate-900">{value}</p>
              </div>)}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!isOwner || demo} onClick={() => selectTab("renew")}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
                ต่ออายุแพ็กเกจ</button>
              <button type="button" disabled={!isOwner || demo} onClick={() => selectTab("notice")}
                className="rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-bold text-blue-700 disabled:opacity-50">
                แจ้งชำระเงิน</button>
            </div>
          </section> : null}

          {(tab === "renew" || tab === "notice") ? <section className={box + " space-y-3 p-4 sm:p-5"}>
            <div className="flex items-center gap-3 pb-1">
              <ToneIcon icon={tab === "renew" ? "wallet" : "upload"} />
              <div><h2 className="text-lg font-extrabold text-[#152541]">
                {tab === "renew" ? "ต่ออายุแพ็กเกจ" : "แจ้งชำระเงิน"}</h2>
                <p className="text-xs leading-5 text-slate-500">
                  {tab === "renew" ? "ส่งความประสงค์ต่ออายุ เพื่อให้ IT ตรวจสอบรายละเอียด" :
                    "กรุณากรอกข้อมูลและแนบหลักฐานการโอนเงิน เพื่อให้ทีมงานตรวจสอบ"}</p>
              </div>
            </div>
            {!isOwner ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              เฉพาะเจ้าของร้านเท่านั้นที่ส่งคำขอแพ็กเกจได้</p> : null}
            {demo ? <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
              บัญชีทดสอบภายในไม่ต้องต่ออายุหรือแจ้งชำระแพ็กเกจ</p> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="min-w-0 rounded-xl border border-[#e4ebf6] p-3">
                <StepLabel number={1}>เลือกแพ็กเกจ</StepLabel>
                <select className={field} value={selectedPackage} disabled={!canSubmit || Boolean(pending)}
                  onChange={(event) => { setSelectedPackage(event.target.value); changed(); }}>
                  {snapshot.packages.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}
                </select>
              </label>
              <div className="rounded-xl border border-[#e4ebf6] p-3">
                <StepLabel number={2}>รอบการชำระเงิน</StepLabel>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["monthly", "yearly"] as const).map((choice) => {
                    const annualAvailable = Boolean(packageRow?.yearly_price) ||
                      (selectedPackage === snapshot.contract.package_id &&
                        snapshot.contract.billing_interval === "yearly" &&
                        Boolean(snapshot.contract.amount_per_cycle));
                    const disabled = !canSubmit || Boolean(pending) || (choice === "yearly" && !annualAvailable);
                    return <button type="button" key={choice} disabled={disabled}
                      aria-pressed={interval === choice}
                      onClick={() => { setInterval(choice); changed(); }}
                      className={"rounded-lg border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 " +
                        (interval === choice ? "border-blue-600 bg-blue-50 text-blue-700" :
                          "border-[#dce5f2] bg-white text-slate-600")}>
                      <span className="mr-2">{interval === choice ? "◉" : "○"}</span>
                      {choice === "monthly" ? "รายเดือน" : "รายปี"}
                    </button>;
                  })}
                </div>
                {interval !== "yearly" && !packageRow?.yearly_price ?
                  <p className="mt-2 text-xs text-slate-500">รายปีใช้ได้เมื่อบริษัทกำหนดราคาแพ็กเกจแล้ว</p> : null}
              </div>
            </div>

            {tab === "notice" ? <>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="min-w-0 rounded-xl border border-[#e4ebf6] p-3">
                  <StepLabel number={3}>ยอดที่ต้องชำระ</StepLabel>
                  <div className={field + " flex min-h-11 items-center justify-between bg-[#f3f6fa] font-bold"}>
                    <span>{packageRow?.contact_sales && due === null ? "ตามสัญญา" : formatMoney(due)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">อ้างอิงข้อมูลแพ็กเกจ · รอ IT ยืนยัน</p>
                </div>
                <label className="min-w-0 rounded-xl border border-[#e4ebf6] p-3">
                  <StepLabel number={4}>จำนวนเงินที่โอน</StepLabel>
                  <input className={field} type="number" inputMode="decimal" min="0.01"
                    step="0.01" max="10000000" value={amount}
                    onChange={(event) => { setAmount(event.target.value); changed(); }}
                    placeholder="กรอกจำนวนเงินจริง (บาท)" disabled={!canSubmit} />
                </label>
                <label className="min-w-0 rounded-xl border border-[#e4ebf6] p-3">
                  <StepLabel number={5}>วันที่และเวลาที่โอน</StepLabel>
                  <input className={field} type="datetime-local" value={transferAt}
                    onChange={(event) => { setTransferAt(event.target.value); changed(); }}
                    disabled={!canSubmit} />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="min-w-0 rounded-xl border border-[#e4ebf6] p-3">
                  <StepLabel number={6}>ชื่อผู้โอน</StepLabel>
                  <input className={field} maxLength={160} placeholder="ระบุชื่อผู้โอน"
                    value={payer} disabled={!canSubmit}
                    onChange={(event) => { setPayer(event.target.value); changed(); }} />
                </label>
                <label className="min-w-0 rounded-xl border border-[#e4ebf6] p-3">
                  <StepLabel number={7}>เลขที่อ้างอิงการโอน</StepLabel>
                  <input className={field} maxLength={120} placeholder="เช่น เลขที่สลิป, Ref. No."
                    value={reference} disabled={!canSubmit}
                    onChange={(event) => { setReference(event.target.value); changed(); }} />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="min-w-0 rounded-xl border border-[#e4ebf6] p-3">
                  <StepLabel number={8}>แนบหลักฐานการโอนเงิน</StepLabel>
                  <span className="mt-2 flex min-h-[70px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-300 bg-[#f9fcff] px-3 py-3 text-center text-xs font-semibold text-blue-700">
                    <Icon name="upload" size={24} />
                    <span>{slip ? slip.name : "คลิกเพื่ออัปโหลดสลิป หรือเลือกไฟล์ JPG / PNG / WebP / PDF (ไม่เกิน 4 MB)"}</span>
                  </span>
                  <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                    disabled={!canSubmit} onChange={(event) => {
                      setSlip(event.target.files?.[0] ?? null); changed();
                    }} />
                </label>
                <label className="min-w-0 rounded-xl border border-[#e4ebf6] p-3">
                  <StepLabel number={9}>หมายเหตุ (ถ้ามี)</StepLabel>
                  <textarea className={field} rows={2} maxLength={500} disabled={!canSubmit}
                    placeholder="ระบุข้อมูลเพิ่มเติมสำหรับทีมงาน เช่น เดือนที่ชำระ"
                    value={note} onChange={(event) => { setNote(event.target.value); changed(); }} />
                </label>
              </div>
              {!hasBank ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                ยังไม่ได้ตั้งค่าบัญชีบริษัท กรุณาติดต่อ Support ก่อนชำระเงิน</p> : null}
            </> : <>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-bold text-blue-700">ค่าบริการต่อรอบตามข้อมูลปัจจุบัน</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-950">
                  {packageRow?.contact_sales && due === null ? "ตามสัญญา" : formatMoney(due)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  หากเป็น CUSTOM หรือยังไม่กำหนดราคา กรุณาสอบถาม IT ก่อนโอนเงิน</p>
              </div>
              <label className="block text-sm font-bold text-slate-700">หมายเหตุถึงทีม IT
                <textarea className={field} rows={2} maxLength={500} value={note}
                  disabled={!canSubmit} onChange={(event) => { setNote(event.target.value); changed(); }} />
              </label>
            </>}
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
              <Icon name="info" size={17} className="mt-0.5" />
              <p>การแจ้งชำระและสลิปยังไม่ถือว่ารับเงินจริง ระบบจะไม่ต่ออายุหรือออกใบเสร็จอัตโนมัติจนกว่าจะยืนยันรายการธนาคาร</p>
            </div>
            <button type="button" disabled={!canSubmit ||
              (tab === "notice" && (!slip || !hasBank || !amount || !transferAt || !payer.trim()))}
              onClick={() => void submit(tab === "renew" ? "renewal_intent" : "payment_notice")}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1862ed] px-5 py-3 text-sm font-bold text-white shadow-[0_6px_12px_rgba(24,98,237,0.2)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
              <Icon name="send" size={17} />{busy ? "กำลังส่งคำขอ..." :
                tab === "renew" ? "ส่งคำขอต่ออายุ" :
                  pending?.kind === "renewal_intent" ? "แนบสลิปและแจ้งชำระคำขอเดิม" : "ส่งแจ้งชำระเงิน"}
            </button>
          </section> : null}

          {tab === "history" ? <section className={box + " space-y-5 p-4 sm:p-5"}>
            <div className="flex items-center gap-3"><ToneIcon icon="history" />
              <h2 className="text-lg font-bold text-slate-900">ประวัติการชำระแพ็กเกจ</h2></div>
            {snapshot.requests.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">
              ยังไม่มีคำขอแพ็กเกจของร้านนี้</p> :
              <div className="overflow-x-auto"><table className="min-w-[640px] w-full text-left text-sm">
                <thead><tr>{["วันที่", "ประเภท", "ยอดที่แจ้ง", "สถานะ", "หลักฐาน / หมายเหตุ"].map((head) =>
                  <th className="border-b p-3 text-xs text-slate-500" key={head}>{head}</th>)}</tr></thead>
                <tbody>{snapshot.requests.map((row) => <tr key={row.id} className="border-b">
                  <td className="p-3">{formatDate(row.submitted_at)}</td>
                  <td className="p-3">{row.kind === "payment_notice" ? "แจ้งโอนเงิน" : "ขอต่ออายุ"}</td>
                  <td className="p-3">{row.amount === null ? "—" : formatMoney(row.amount)}</td>
                  <td className="p-3 font-semibold">{LABELS[row.status] || row.status}</td>
                  <td className="p-3">{row.has_evidence ? "แนบหลักฐานแล้ว" : "ไม่มีสลิป"}
                    {row.review_note ? " · " + row.review_note : ""}</td>
                </tr>)}</tbody>
              </table></div>}
            <h3 className="text-base font-bold text-slate-900">รอบบิลที่บันทึกแล้ว</h3>
            {snapshot.cycles.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">
              ยังไม่มีรอบบิลที่บันทึกไว้</p> :
              <div className="overflow-x-auto"><table className="min-w-[570px] w-full text-left text-sm">
                <thead><tr>{["วันเริ่ม", "วันสิ้นสุด", "ยอดเรียกเก็บ", "ยอดบันทึกชำระ", "สถานะ"].map((head) =>
                  <th className="border-b p-3 text-xs text-slate-500" key={head}>{head}</th>)}</tr></thead>
                <tbody>{snapshot.cycles.map((cycle) => <tr key={cycle.id} className="border-b">
                  <td className="p-3">{cycle.period_start}</td><td className="p-3">{cycle.period_end}</td>
                  <td className="p-3">{formatMoney(cycle.amount_due)}</td>
                  <td className="p-3">{formatMoney(cycle.amount_paid)}</td><td className="p-3">{cycle.status}</td>
                </tr>)}</tbody>
              </table></div>}
          </section> : null}

          {tab === "documents" ? <section className={box + " p-5"}>
            <div className="flex items-center gap-3"><ToneIcon icon="file" />
              <h2 className="text-lg font-bold text-slate-900">เอกสารแพ็กเกจ</h2></div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              ใบเสนอราคาและใบเสร็จรับเงินจริงเป็นคนละประเภท เอกสารจะเปิดดาวน์โหลดเมื่อออกจริงแล้วเท่านั้น</p>
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              ยังไม่มีเอกสารแพ็กเกจที่ออกจริงสำหรับดาวน์โหลด</div>
            {!snapshot.issuer.vat_registered ? <p className="mt-3 text-xs text-slate-500">
              บริษัทยังไม่ได้จดทะเบียน VAT และไม่มีการออกใบกำกับภาษี VAT อัตโนมัติ</p> : null}
          </section> : null}
        </main>

        <aside className="min-w-0 space-y-3 xl:pt-1">
          <section className={box + " space-y-3 p-4"}>
            <div className="flex items-center gap-3"><ToneIcon icon="bank" />
              <div><h2 className="text-base font-extrabold text-[#152541]">บัญชีรับชำระของบริษัท</h2>
                <p className="text-xs text-slate-500">สำหรับค่าบริการแพ็กเกจ CpIPOS เท่านั้น</p></div></div>
            {hasBank ? <dl className="divide-y divide-[#e5edfa] rounded-xl border border-[#e0ebfb] bg-[#f8fbff] px-3">
              <div className="grid grid-cols-[95px_1fr] gap-2 py-3 text-xs">
                <dt className="font-semibold text-slate-500">ธนาคาร</dt>
                <dd className="break-words font-bold text-slate-900">{snapshot.issuer.bank_name || "—"}</dd></div>
              <div className="grid grid-cols-[95px_1fr] gap-2 py-3 text-xs">
                <dt className="font-semibold text-slate-500">ชื่อบัญชี</dt>
                <dd className="break-words font-bold text-slate-900">{snapshot.issuer.account_name || "—"}</dd></div>
              <div className="grid grid-cols-[95px_1fr] gap-2 py-3 text-xs">
                <dt className="font-semibold text-slate-500">เลขบัญชี</dt>
                <dd className="flex flex-wrap items-center justify-between gap-1 font-extrabold text-[#1b3f80]">
                  <span className="break-all">{snapshot.issuer.account_number || "—"}</span>
                  {snapshot.issuer.account_number ? <button type="button" onClick={() => void copyAccount()}
                    aria-label="คัดลอกเลขบัญชี" className="rounded-lg border border-[#dce6f8] bg-white p-1.5 text-blue-600">
                    <Icon name="copy" size={16} /></button> : null}</dd></div>
              {snapshot.issuer.promptpay_id ? <div className="grid grid-cols-[95px_1fr] gap-2 py-3 text-xs">
                <dt className="font-semibold text-slate-500">พร้อมเพย์</dt>
                <dd className="break-all font-bold text-[#1b3f80]">{snapshot.issuer.promptpay_id}</dd>
              </div> : null}
            </dl> : <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              บริษัทยังไม่ได้ตั้งค่าบัญชีรับชำระ กรุณาติดต่อ Support ก่อนโอนเงิน</p>}
            {copyStatus ? <p role="status" className="text-xs text-blue-700">{copyStatus}</p> : null}
            <p className="break-words text-xs text-slate-500">{snapshot.issuer.name}</p>
            <p className="text-xs leading-5 text-slate-500">ไม่ใช่บัญชีรับเงินขายสินค้าหน้าร้าน</p>
          </section>

          <section className={box + " space-y-2 p-4"}>
            <button type="button" aria-expanded={lineOpen} onClick={() => setLineOpen(!lineOpen)}
              className="flex w-full items-center gap-3 text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-xs font-black text-emerald-600">
                LINE</span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm text-slate-900">QR LINE ติดต่อบริษัท</strong>
                <span className="text-xs text-slate-500">สอบถามข้อมูลเพิ่มเติมหรือปัญหาการใช้งาน</span>
              </span>
              <span className="text-sm text-slate-500">{lineOpen ? "ซ่อน" : "แสดง"}</span>
            </button>
            <Image src="/brand/line-company-qr.png" width={440} height={440}
              alt="QR LINE ติดต่อบริษัท ไม่ใช่ QR ชำระเงิน"
              className={"mx-auto h-auto rounded-xl border border-slate-200 transition-all " +
                (lineOpen ? "max-w-[190px]" : "max-w-[84px]")} />
            <p className="text-[11px] text-slate-500">QR LINE สำหรับติดต่อเท่านั้น ไม่ใช่ QR ชำระเงิน</p>
          </section>

          <section className={box + " space-y-3 p-4"}>
            <div className="flex items-center gap-3"><ToneIcon icon="support" />
              <div><h2 className="text-base font-extrabold text-[#152541]">ติดต่อสอบถาม / แจ้งปัญหา</h2>
                <p className="text-xs text-slate-500">เกี่ยวกับค่าบริการ แพ็กเกจ หรือการใช้งาน</p></div></div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <a href="tel:0985460355"
                className="flex items-center justify-center gap-2 rounded-xl bg-[#edf5ff] px-3 py-3 text-sm font-bold text-blue-700">
                <Icon name="phone" size={16} />โทร. 0985460355</a>
              <a href={"mailto:" + snapshot.issuer.support_email}
                className="flex items-center justify-center gap-2 break-all rounded-xl bg-[#edf5ff] px-3 py-3 text-xs font-bold text-blue-700">
                <Icon name="mail" size={16} />{snapshot.issuer.support_email}</a>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </section>;
}

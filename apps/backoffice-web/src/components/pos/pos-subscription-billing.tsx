"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PosSubscriptionWorkspace } from "@/lib/services/pos-subscription-billing-service";

type Tab = "overview" | "renewal" | "history" | "documents";

const statuses: Record<string, string> = {
  active: "ใช้งานอยู่",
  trial: "ทดลองใช้งาน",
  suspended: "ระงับบริการ",
  expired: "หมดอายุ",
  locked: "ถูกจำกัดการใช้งาน",
  cancelled: "ยกเลิกสัญญา",
  no_contract: "ยังไม่มีสัญญา",
  pending: "รอตรวจสอบ",
  under_review: "กำลังตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่ผ่านการตรวจสอบ",
  paid: "บันทึกชำระแล้ว",
  cancelled_request: "ยกเลิกรายการ"
};

function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—"
    : new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(parsed);
}
function amount(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("th-TH", {
    style: "currency", currency: "THB"
  }).format(value);
}
function quota(value: number | null) {
  return value == null ? "ตามสัญญา" : value >= 999999 ? "ไม่จำกัด" : value.toLocaleString("th-TH");
}
function interval(value: string | null) {
  return value === "monthly" ? "รายเดือน" : value === "yearly" ? "รายปี" : "ตามสัญญา";
}

export function PosSubscriptionBilling({ data }: { data: PosSubscriptionWorkspace }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [renewalInterval, setRenewalInterval] = useState<"monthly" | "yearly">(
    data.billingInterval === "yearly" ? "yearly" : "monthly"
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const company = data.company;
  const isCustom = data.quotaMode === "custom" || data.quotaMode === "exempt";
  const price = data.amountPerCycle == null || isCustom && data.amountPerCycle <= 0
    ? "ตามสัญญา" : amount(data.amountPerCycle);
  const expiry = data.daysRemaining == null ? "ตามสัญญา / ไม่ระบุ"
    : data.daysRemaining < 0 ? "เกินกำหนด " + Math.abs(data.daysRemaining) + " วัน"
    : data.daysRemaining === 0 ? "ครบกำหนดวันนี้" : "อีก " + data.daysRemaining + " วัน";
  const hasBank = Boolean(company?.billing_bank_name && company.billing_bank_account_name && company.billing_bank_account_number);
  const hasPending = data.requests.some((row) => row.status === "pending" || row.status === "under_review");
  const mayRequest = data.canManage && !isCustom && !hasPending
    && Boolean(data.packageCode) && data.status !== "no_contract";
  const statusTone = data.status === "active" ? "bg-emerald-100 text-emerald-800"
    : data.status === "trial" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900";

  async function requestRenewal() {
    if (!mayRequest) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/pos/billing/renewal-requests", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billing_interval: renewalInterval })
      });
      const result = await response.json() as {
        data?: { message: string }; error?: { message?: string }
      };
      if (!response.ok || !result.data) throw new Error(result.error?.message || "ไม่สามารถส่งคำขอได้");
      setNotice("ส่งคำขอต่ออายุให้ฝ่าย IT แล้ว ยังไม่ได้ชำระเงินหรือเปิดแพ็กเกจใหม่");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function copyAccount() {
    if (!company?.billing_bank_account_number) return;
    try {
      await navigator.clipboard.writeText(company.billing_bank_account_number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("ไม่สามารถคัดลอกเลขบัญชีอัตโนมัติได้");
    }
  }

  const tabItems: Array<{ key: Tab; text: string }> = [
    { key: "overview", text: "ภาพรวม" },
    { key: "renewal", text: "ต่ออายุแพ็กเกจ" },
    { key: "history", text: "ประวัติการชำระ" },
    { key: "documents", text: "เอกสาร" }
  ];

  return (
    <section className="min-h-full w-full overflow-auto bg-[#f5f8ff] px-3 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1480px] space-y-5">
        <header className="rounded-[24px] border border-blue-100 bg-gradient-to-r from-white via-white to-blue-50 px-5 py-6 shadow-sm sm:px-7">
          <p className="text-xs font-bold tracking-[0.16em] text-blue-600">CPIPOS / SUBSCRIPTION</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">แพ็กเกจและการชำระเงิน</h1>
              <p className="mt-1 text-sm text-slate-500">ตรวจสอบสิทธิ์ใช้งาน ต่ออายุ และประวัติแพ็กเกจของร้านค้า</p>
            </div>
            <span className={"rounded-full px-4 py-2 text-sm font-bold " + statusTone}>
              {statuses[data.status] || data.status}
            </span>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="ร้านค้า / รหัสร้าน" value={data.storeName} detail={data.storeCode} />
            <Stat label="แพ็กเกจปัจจุบัน" value={data.packageName || "ยังไม่กำหนด"} detail={data.packageCode || "—"} />
            <Stat label="วันหมดอายุ" value={date(data.expiresAt)} detail={expiry}
              accent={data.daysRemaining != null && data.daysRemaining <= 7} />
            <Stat label="ค่าบริการต่อรอบ" value={price} detail={interval(data.billingInterval)} />
          </div>
        </header>

        {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{notice}</p> : null}
        {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <main className="min-w-0 rounded-[22px] border border-slate-200 bg-white shadow-sm">
            <nav aria-label="เมนูการชำระแพ็กเกจ" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-3 sm:px-5">
              {tabItems.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)}
                aria-current={tab === item.key ? "page" : undefined}
                className={"whitespace-nowrap rounded-t-xl border-b-2 px-4 py-3 text-sm font-bold transition " +
                  (tab === item.key ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-transparent text-slate-500 hover:bg-slate-50")}>
                {item.text}
              </button>)}
            </nav>
            <div className="space-y-5 p-4 sm:p-6">
              {tab === "overview" ? <>
                <div>
                  <h2 className="text-lg font-black text-slate-900">สิทธิ์การใช้งาน</h2>
                  <p className="mt-1 text-sm text-slate-500">ข้อมูลตามแพ็กเกจของร้านปัจจุบัน</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Stat label="จำนวนสาขา" value={quota(data.maxBranches)} />
                    <Stat label="เครื่องแคชเชียร์" value={quota(data.maxDevices)} detail="ตามข้อกำหนดแพ็กเกจ" />
                    <Stat label="ผู้ใช้งาน" value={quota(data.maxUsers)} />
                  </div>
                </div>
                <div className="grid gap-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <h3 className="font-black text-slate-900">ต่ออายุหรือสอบถามแพ็กเกจ</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      เลือกรอบการต่ออายุและส่งคำขอให้ฝ่าย IT ตรวจสอบก่อนเริ่มชำระ
                    </p>
                  </div>
                  <button type="button" onClick={() => setTab("renewal")}
                    className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700">
                    ดูการต่ออายุ →
                  </button>
                </div>
                {hasPending ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  มีคำขอแพ็กเกจที่กำลังรอตรวจสอบอยู่ ดูรายละเอียดในแท็บประวัติการชำระ
                </p> : null}
                <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                  หน้านี้เป็นการชำระค่าบริการ CpIPOS ไม่ใช่หน้ารับชำระค่าสินค้าของลูกค้าร้านค้า
                  การส่งคำขอไม่ทำให้แพ็กเกจต่ออายุหรือออกใบเสร็จโดยอัตโนมัติ
                </p>
              </> : null}

              {tab === "renewal" ? <>
                <h2 className="text-xl font-black text-slate-900">ต่ออายุแพ็กเกจ</h2>
                <p className="text-sm leading-6 text-slate-600">
                  แพ็กเกจปัจจุบัน: <strong>{data.packageName || "ยังไม่กำหนด"}</strong> · รอบเดิม: {interval(data.billingInterval)}
                </p>
                {isCustom ? <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                  แพ็กเกจ CUSTOM / สัญญาพิเศษ: ติดต่อ IT เพื่อรับราคาที่ตกลงกันและกำหนดรอบต่ออายุ
                </p> : <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["monthly", "yearly"] as const).map((value) => <button type="button" key={value}
                      onClick={() => setRenewalInterval(value)}
                      className={"rounded-2xl border p-5 text-left transition " + (renewalInterval === value
                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                        : "border-slate-200 bg-white hover:border-blue-200")}>
                      <span className="block font-black text-slate-900">{interval(value)}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        ยอดจริงจะคำนวณจากแพ็กเกจ/สัญญาที่ฝ่าย IT กำหนด
                      </span>
                    </button>)}
                  </div>
                  <button type="button" disabled={!mayRequest || busy} onClick={() => void requestRenewal()}
                    className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                    {busy ? "กำลังส่งคำขอ..." : "ส่งคำขอต่ออายุให้ IT"}
                  </button>
                  {hasPending ? <p className="text-sm text-amber-700">มีคำขอที่ยังไม่ปิดรายการ กรุณารอผลก่อนส่งใหม่</p> : null}
                  {!data.canManage ? <p className="text-sm text-slate-600">เจ้าของร้านหรือผู้จัดการเท่านั้นที่ส่งคำขอได้</p> : null}
                </>}
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                  ยังไม่เปิดระบบแนบสลิปหรือยืนยันรับเงินจริงในหน้านี้ อย่าใช้การส่งคำขอเป็นหลักฐานชำระเงิน
                  หากได้โอนเงินแล้ว กรุณาติดต่อฝ่ายบัญชีพร้อมหลักฐานผ่านช่องทางด้านขวา
                </div>
              </> : null}

              {tab === "history" ? <>
                <h2 className="text-xl font-black text-slate-900">ประวัติแพ็กเกจและคำขอชำระ</h2>
                {!data.canManage ? <p className="text-sm text-slate-600">ประวัติการชำระแสดงให้เจ้าของร้านหรือผู้จัดการเท่านั้น</p> :
                  <>
                    <h3 className="font-bold text-slate-800">คำขอแพ็กเกจ</h3>
                    {data.requests.length ? <div className="overflow-x-auto">
                      <table className="w-full min-w-[630px] text-left text-sm">
                        <thead><tr className="border-b text-slate-500">
                          {["วันที่ส่ง","ประเภท","ยอดแจ้งชำระ","สถานะ","หลักฐาน","หมายเหตุ IT"].map((x) =>
                            <th key={x} className="p-3">{x}</th>)}
                        </tr></thead>
                        <tbody>{data.requests.map((r) => <tr key={r.id} className="border-b border-slate-100">
                          <td className="p-3">{date(r.submitted_at)}</td>
                          <td className="p-3">{r.request_type}</td>
                          <td className="p-3">{amount(r.amount_reported)}</td>
                          <td className="p-3 font-bold">{statuses[r.status] || r.status}</td>
                          <td className="p-3">{r.has_evidence ? "แนบแล้ว" : "ยังไม่มี"}</td>
                          <td className="p-3">{r.review_note || "—"}</td>
                        </tr>)}</tbody>
                      </table>
                    </div> : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">ยังไม่มีคำขอต่ออายุหรือแจ้งชำระ</p>}
                    <h3 className="font-bold text-slate-800">รอบบิลแพ็กเกจ</h3>
                    {data.cycles.length ? <div className="overflow-x-auto">
                      <table className="w-full min-w-[580px] text-left text-sm">
                        <thead><tr className="border-b text-slate-500">
                          {["รอบเริ่ม","รอบสิ้นสุด","เรียกเก็บ","บันทึกรับ","สถานะ"].map((x) =>
                            <th key={x} className="p-3">{x}</th>)}
                        </tr></thead>
                        <tbody>{data.cycles.map((r) => <tr key={r.id} className="border-b border-slate-100">
                          <td className="p-3">{date(r.period_start)}</td>
                          <td className="p-3">{date(r.period_end)}</td>
                          <td className="p-3">{amount(r.amount_due)}</td>
                          <td className="p-3">{amount(r.amount_paid)}</td>
                          <td className="p-3">{statuses[r.status] || r.status}</td>
                        </tr>)}</tbody>
                      </table>
                    </div> : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">ยังไม่มีรอบบิลแพ็กเกจ</p>}
                  </>}
              </> : null}

              {tab === "documents" ? <div className="space-y-3">
                <h2 className="text-xl font-black text-slate-900">เอกสารค่าบริการ</h2>
                <p className="text-sm leading-6 text-slate-600">
                  ใบเสนอราคาและใบเสร็จรับเงินจริงจะแสดงที่นี่เมื่อระบบออกเอกสารจากรายการธุรกรรมที่ผ่านการตรวจสอบแล้ว
                </p>
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  ยังไม่มีเอกสาร PDF ที่ออกจริง · ขณะนี้บริษัทไม่ได้จดทะเบียน VAT
                  และจะไม่ออกใบกำกับภาษี VAT อัตโนมัติ
                </p>
              </div> : null}
            </div>
          </main>

          <aside className="space-y-4">
            <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-black text-slate-900">ข้อมูลชำระค่าบริการบริษัท</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                บัญชีค่าบริการ CpIPOS ไม่ใช่บัญชีรับเงินขายสินค้าของร้าน
              </p>
              {data.canManage && hasBank && company ? <div className="mt-4 space-y-3 text-sm">
                <p className="font-bold text-slate-800">{company.billing_legal_name_th}</p>
                <Detail label="ธนาคาร" value={company.billing_bank_name} />
                <Detail label="ชื่อบัญชี" value={company.billing_bank_account_name} />
                <Detail label="เลขบัญชี" value={company.billing_bank_account_number} />
                {company.billing_promptpay_id ? <Detail label="พร้อมเพย์" value={company.billing_promptpay_id} /> : null}
                <button type="button" onClick={() => void copyAccount()}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 font-bold text-blue-700">
                  {copied ? "คัดลอกแล้ว" : "คัดลอกเลขบัญชี"}
                </button>
              </div> : <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                {data.canManage ? "ยังไม่มีบัญชีรับชำระที่บริษัทตรวจสอบและบันทึกใน IT"
                  : "ขอข้อมูลชำระแพ็กเกจได้จากเจ้าของร้านหรือ IT"}
              </p>}
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
                อย่าโอนเงินโดยอาศัย QR LINE ด้านล่าง เพราะเป็น QR สำหรับติดต่อเท่านั้น
              </p>
            </section>
            <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-900">ติดต่อบริษัท / Support</h2>
              <p className="mt-1 text-xs text-slate-500">QR LINE สำหรับสอบถาม ไม่ใช่ QR รับเงิน</p>
              <Image src="/brand/line-company-qr.png" alt="QR LINE ติดต่อบริษัท"
                width={280} height={280} className="mx-auto mt-4 h-auto w-full max-w-[185px] rounded-xl border border-slate-100" />
              <a href="tel:0985460355"
                className="mt-4 block rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-black text-white hover:bg-blue-700">
                โทร. 0985460355
              </a>
              <p className="mt-3 break-all text-xs text-slate-500">
                Support: {company?.support_email || "cuttingpointtech.support@gmail.com"}
              </p>
              <p className="mt-1 break-all text-xs text-slate-500">
                ฝ่ายบัญชี: {company?.billing_email || "cuttingpointtech@gmail.com"}
              </p>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, detail, accent = false }: {
  label: string; value: string; detail?: string; accent?: boolean
}) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-bold text-slate-500">{label}</p>
    <p className={"mt-2 break-words text-lg font-black " + (accent ? "text-amber-700" : "text-slate-950")}>{value}</p>
    {detail ? <p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p> : null}
  </div>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3">
    <p className="text-xs font-semibold text-slate-500">{label}</p>
    <p className="mt-1 break-all font-bold text-slate-900">{value}</p>
  </div>;
}

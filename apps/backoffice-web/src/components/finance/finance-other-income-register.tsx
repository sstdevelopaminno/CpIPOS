"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { currencyToMinor, type FinanceCurrency } from "@/lib/finance-accounting-core";
import { FinanceDialog } from "./finance-dialog";
import type { OtherIncomeRow } from "@/lib/server/finance-other-income-service";

type Branch = { id: string; name: string; code: string };
type ChartAccount = { id: string; code: string; name: string; type: string };
type Envelope<T> = { data?: T | null; error?: { code: string; message: string } | null };
type PaymentMethod = "cash" | "transfer" | "card" | "cheque" | "other";
const apiPath = "/api/finance/accounting/other-income";
const field = "h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-[13px] text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100";
const label = "mb-1.5 block text-xs font-bold text-slate-600";
const action = "inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-blue-50 disabled:opacity-40";
const primary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#1658a4] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[#0f447f] disabled:cursor-not-allowed disabled:opacity-40";
const methods: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "เงินโอน" },
  { value: "card", label: "บัตร" },
  { value: "cheque", label: "เช็ค" },
  { value: "other", label: "อื่น ๆ" }
];
const statuses: Record<string, string> = {
  draft: "แบบร่าง", submitted: "รออนุมัติ", approved: "อนุมัติแล้ว",
  issued: "ออกเอกสารแล้ว", rejected: "ส่งกลับแก้ไข", voided: "ยกเลิก"
};
const errors: Record<string, string> = {
  finance_accounting_not_enabled: "ยังไม่เปิดใช้งานทะเบียนรายรับอื่น ๆ จนกว่าจะทดสอบฐานข้อมูลและสิทธิ์ครบ",
  finance_accounting_schema_unavailable: "ทะเบียนรายรับอื่น ๆ ยังไม่ได้ติดตั้งบนฐานข้อมูลที่ใช้งาน",
  finance_accounting_self_approval_forbidden: "ผู้จัดทำรายการไม่สามารถอนุมัติรายการของตนเองได้",
  finance_accounting_version_conflict: "รายการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่",
  finance_accounting_idempotency_conflict: "รหัสคำขอเดิมมีรายละเอียดไม่ตรงกัน",
  finance_accounting_duplicate: "พบรายการซ้ำ กรุณาตรวจสอบเลขที่เอกสาร",
  finance_accounting_other_income_invalid: "ข้อมูลรายรับอื่น ๆ ไม่ถูกต้อง",
  finance_accounting_other_income_total_invalid: "ยอดรวมไม่ถูกต้องหรือสูงเกินกว่าระบบรองรับ"
};
function dash(value: string | null | undefined) {
  return value?.trim() && value !== "-" ? value : "-";
}
function bangkokToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = (key: string) => parts.find(part => part.type === key)?.value ?? "";
  return value("year") + "-" + value("month") + "-" + value("day");
}
function cash(value: number, currency: FinanceCurrency) {
  const digits = currency === "LAK" ? 0 : 2;
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(value / (digits ? 100 : 1));
}
function displayedTime(iso: string) {
  const timestamp = new Date(iso);
  if (Number.isNaN(timestamp.getTime())) return "-";
  return timestamp.toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}
function displayedDate(raw: string) {
  const [y, m, d] = raw.split("-");
  return y && m && d && Number.isFinite(Number(y)) ? d + "/" + m + "/" + (Number(y) + 543) : dash(raw);
}
function methodName(value: string) {
  return methods.find(item => item.value === value)?.label ?? "-";
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !body?.data) {
    const code = body?.error?.code ?? "finance_accounting_unavailable";
    throw new Error(errors[code] ?? body?.error?.message ?? code);
  }
  return body.data;
}

export function FinanceOtherIncomeRegister() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branch, setBranch] = useState("");
  const [items, setItems] = useState<OtherIncomeRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<OtherIncomeRow | null>(null);
  const [postAccounts, setPostAccounts] = useState<ChartAccount[]>([]);
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [postAllowed, setPostAllowed] = useState(false);
  const [reason, setReason] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [date, setDate] = useState(bangkokToday);
  const [description, setDescription] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [currency, setCurrency] = useState<FinanceCurrency>("THB");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const branchResult = await request<{ branches: Branch[] }>("/api/finance/accounting?view=branches");
      setBranches(branchResult.branches);
      const validBranch = branch && branchResult.branches.some(item => item.id === branch) ? branch : "";
      const income = await request<{ rows: OtherIncomeRow[]; hasMore: boolean }>(
        apiPath + (validBranch ? "?branchId=" + encodeURIComponent(validBranch) : "")
      );
      setItems(income.rows);
      setHasMore(income.hasMore);
      setReady(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "ไม่สามารถอ่านทะเบียนรายรับอื่น ๆ");
      setItems([]);
      setReady(false);
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  const totalMinor = useMemo(() => {
    const price = Number(unitPrice);
    const qty = Number(quantity);
    if (!unitPrice || !Number.isFinite(price) || !Number.isFinite(qty) ||
        price <= 0 || qty <= 0 || qty > 999999) return null;
    try {
      const unit = currencyToMinor(price, currency);
      const amount = Math.round(qty * unit);
      return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
    } catch {
      return null;
    }
  }, [quantity, unitPrice, currency]);

  const totals = useMemo(() => {
    const result = new Map<FinanceCurrency, number>();
    for (const item of items) {
      if (item.status === "voided") continue;
      result.set(item.currency, (result.get(item.currency) ?? 0) + item.amountMinor);
    }
    return Array.from(result.entries());
  }, [items]);

  function openCreate() {
    if (!ready) return;
    if (!branch && branches.length === 1) setBranch(branches[0].id);
    setDate(bangkokToday());
    setRequestKey(crypto.randomUUID());
    setDescription(""); setCounterparty(""); setQuantity("1");
    setUnitPrice(""); setCurrency("THB"); setPaymentMethod("cash");
    setNote(""); setError("");
    setCreateOpen(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || totalMinor === null) {
      setError("กรุณาตรวจสอบจำนวน ราคา และสกุลเงินก่อนบันทึก");
      return;
    }
    const targetBranch = branch || (branches.length === 1 ? branches[0].id : "");
    if (!targetBranch) { setError("กรุณาเลือกสาขาที่ได้รับสิทธิ์"); return; }
    setBusy(true); setError("");
    try {
      const result = await request<{ number: string; status: string }>(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          branchId: targetBranch, requestKey,
          date, currency, description, counterparty,
          quantity: Number(quantity), unitPrice: Number(unitPrice),
          paymentMethod, note
        })
      });
      setCreateOpen(false);
      setNotice("บันทึกเลขที่ " + result.number + " สำเร็จ · เป็นแบบร่าง รอการอนุมัติ");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "บันทึกไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function openDetail(item: OtherIncomeRow) {
    setError(""); setReason(""); setSelected(item);
    setDebit("");setCredit("");setPostAccounts([]);setPostAllowed(false);
    if (item.status !== "issued" || item.postedJournalId) return;
    try {
      const payload = await request<{ accounts: ChartAccount[] }>("/api/finance/accounting?view=accounts");
      setPostAccounts(payload.accounts);
      setPostAllowed(true);
    } catch {
      // Reading/approving the income voucher does not imply GL posting access.
      setPostAllowed(false);
    }
  }

  async function postIncome() {
    if (!selected || !debit || !credit || busy || !postAllowed) return;
    setBusy(true);setError("");
    try {
      await request<{ id: string; idempotent: boolean }>("/api/finance/accounting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "post_document",
          documentId: selected.id,
          debitAccountId: debit,
          creditAccountId: credit
        })
      });
      setSelected(null);
      setNotice("ลงบัญชีจากเลขที่ " + selected.number + " สำเร็จ · ตรวจสอบรหัสรายการซ้ำแล้ว");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "ไม่สามารถลงบัญชีได้");
    } finally { setBusy(false); }
  }

  async function transition(type: "submit" | "approve" | "reject" | "issue" | "void") {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      await request<unknown>(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transition", documentId: selected.id,
          version: selected.version, transition: type, reason
        })
      });
      setSelected(null);
      setNotice("อัปเดตสถานะเอกสารแล้ว");
      setReason("");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  return (
    <section className="w-full min-w-0 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-[#f6f9fd] px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold text-[#163d68]">ทะเบียนรายรับอื่น ๆ</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            รายรับที่บันทึกจากแหล่งอื่น ไม่เชื่อมโยงหรือสร้างยอดขาย POS
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={action} disabled={loading} onClick={() => void load()}>รีเฟรช</button>
          <button type="button" className={primary} disabled={!ready || loading || !branches.length} onClick={openCreate}>
            <span aria-hidden="true" className="text-lg leading-none">+</span> เพิ่มรายรับ
          </button>
        </div>
      </header>

      {!ready && error ? (
        <p role="alert" className="mx-5 my-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{error}</p>
      ) : null}
      {notice ? <p role="status" className="mx-5 my-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">{notice}</p> : null}

      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-3">
        <div className="min-w-[200px] max-w-sm flex-1">
          <label className={label} htmlFor="other-income-branch">สาขา</label>
          <select id="other-income-branch" className={field} value={branch}
            onChange={event => setBranch(event.target.value)}>
            <option value="">ทุกสาขาที่ได้รับสิทธิ์</option>
            {branches.map(item => <option key={item.id} value={item.id}>
              {item.name} ({item.code})
            </option>)}
          </select>
        </div>
        <p className="pb-2 text-xs text-slate-500">แสดงสูงสุด 100 รายการล่าสุด · เลขเอกสารออกจากระบบ</p>
      </div>

      {totals.length ? (
        <div className="flex flex-wrap gap-6 border-b border-slate-200 px-5 py-3">
          {totals.map(([unit, total]) => (
            <div key={unit}>
              <p className="text-[11px] text-slate-500">รวมรายการที่แสดง ({unit})</p>
              <p className="mt-0.5 text-lg font-extrabold tabular-nums text-[#164d87]">{cash(total, unit)}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[1450px] border-collapse text-xs">
          <thead className="border-b border-[#ccdae9] bg-[#eaf1fa] text-[#244466]">
            <tr>
              {["ลำดับ", "วันที่", "เวลา", "เลขที่บิล", "รายการ", "ราคา/หน่วย", "จำนวน",
                "สกุลเงิน", "สาขา", "ช่องทางรับชำระ", "ยอดบิล", "หมายเหตุ", "สถานะ", "ดำเนินการ"].map(head => (
                <th key={head} scope="col" className="whitespace-nowrap px-3 py-3 text-left font-bold">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item, index) => {
              const branchName = branches.find(value => value.id === item.branchId)?.name ?? "-";
              return (
                <tr key={item.id} className="align-top transition-colors hover:bg-[#f7faff]">
                  <td className="px-3 py-3 text-slate-500 tabular-nums">{index + 1}</td>
                  <td className="whitespace-nowrap px-3 py-3">{displayedDate(item.date)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{displayedTime(item.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-bold text-blue-800">{item.number}</td>
                  <td className="max-w-[200px] break-words px-3 py-3">{dash(item.description)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{cash(item.unitMinor, item.currency)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{item.quantity}</td>
                  <td className="px-3 py-3">{item.currency}</td>
                  <td className="whitespace-nowrap px-3 py-3">{branchName}</td>
                  <td className="whitespace-nowrap px-3 py-3">{methodName(item.paymentMethod)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums">{cash(item.amountMinor, item.currency)}</td>
                  <td className="max-w-[200px] break-words px-3 py-3">{dash(item.note)}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">{statuses[item.status] ?? item.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" className={action}
                      onClick={() => { void openDetail(item); }}>เรียกดู</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading ? <p role="status" className="px-5 py-8 text-sm text-slate-500">กำลังโหลดรายการ...</p> : null}
        {!loading && ready && !items.length ?
          <p className="px-5 py-10 text-center text-sm text-slate-500">ยังไม่มีรายการรายรับอื่น ๆ ที่บันทึกไว้</p> : null}
      </div>
      {hasMore ? <p className="border-t border-slate-200 px-5 py-3 text-xs text-amber-800">มีรายการมากกว่า 100 รายการ โปรดเลือกสาขาเพื่อจำกัดผลลัพธ์</p> : null}

      <FinanceDialog open={createOpen} busy={busy} onClose={() => { setCreateOpen(false); setError(""); }}
        title="เพิ่มรายรับอื่น ๆ" description="ระบบคำนวณยอดและรันเลขบิลให้อัตโนมัติหลังบันทึก · ไม่สร้างรายการ POS">
        <form onSubmit={event => void save(event)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="other-income-form-branch">สาขา *</label>
              <select id="other-income-form-branch" className={field} value={branch}
                onChange={event => setBranch(event.target.value)} required>
                <option value="">เลือกสาขา</option>
                {branches.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="other-income-date">วันที่รับเงิน *</label>
              <input id="other-income-date" type="date" className={field} required
                value={date} onChange={event => setDate(event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="other-income-desc">รายการ / รายละเอียดรายรับ</label>
              <input id="other-income-desc" className={field} value={description}
                maxLength={500} placeholder="ไม่ระบุจะแสดง -" onChange={event => setDescription(event.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="other-income-quantity">จำนวน *</label>
              <input id="other-income-quantity" className={field} type="number" min="0.000001" step="any"
                required value={quantity} onChange={event => setQuantity(event.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="other-income-price">ราคาต่อหน่วย *</label>
              <input id="other-income-price" className={field} type="number" min={currency === "LAK" ? "1" : "0.01"} step={currency === "LAK" ? "1" : "0.01"}
                required value={unitPrice} onChange={event => setUnitPrice(event.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="other-income-currency">สกุลเงิน *</label>
              <select id="other-income-currency" className={field} value={currency}
                onChange={event => setCurrency(event.target.value as FinanceCurrency)}>
                <option value="THB">THB — บาท</option>
                <option value="LAK">LAK — กีบ</option>
                <option value="USD">USD — ดอลลาร์</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor="other-income-method">ช่องทางรับชำระ *</label>
              <select id="other-income-method" className={field} value={paymentMethod}
                onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}>
                {methods.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="other-income-party">ผู้ชำระ / แหล่งรายรับ</label>
              <input id="other-income-party" className={field} maxLength={240}
                placeholder="เว้นว่างได้" value={counterparty}
                onChange={event => setCounterparty(event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="other-income-note">หมายเหตุ</label>
              <textarea id="other-income-note" rows={2} maxLength={1000}
                placeholder="เว้นว่างได้ ระบบแสดง - ในตาราง" value={note}
                onChange={event => setNote(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"/>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d5e4f4] bg-[#f2f7fd] px-4 py-4">
            <div>
              <p className="text-xs font-bold text-slate-600">ยอดรวมที่คำนวณ</p>
              <p className="text-[11px] text-slate-500">ราคา × จำนวน · ระบบคำนวณอีกครั้งที่เซิร์ฟเวอร์</p>
            </div>
            <p className="text-2xl font-black tabular-nums text-blue-800">
              {totalMinor === null ? "-" : cash(totalMinor, currency)} <span className="text-sm">{currency}</span>
            </p>
          </div>
          {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
            <button type="button" className={action} disabled={busy} onClick={() => setCreateOpen(false)}>ยกเลิก</button>
            <button type="submit" className={primary} disabled={busy || totalMinor === null || !date || (!branch && branches.length !== 1)}>
              {busy ? "กำลังบันทึก..." : "บันทึกรายรับ"}
            </button>
          </footer>
        </form>
      </FinanceDialog>

      <FinanceDialog open={Boolean(selected)} busy={busy} onClose={() => { setSelected(null); setError(""); }}
        title={selected ? "รายละเอียด " + selected.number : "รายละเอียดรายรับ"}
        description="ทะเบียนรายรับอื่น ๆ · รายการนี้ไม่ใช่บิลขาย POS">
        {selected ? (
          <div className="space-y-4">
            <div className="grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2">
              {[
                ["วันที่", displayedDate(selected.date) + " " + displayedTime(selected.createdAt)],
                ["เลขที่เอกสาร", selected.number],
                ["รายการ", dash(selected.description)],
                ["ผู้ชำระ", dash(selected.counterparty)],
                ["จำนวน", String(selected.quantity)],
                ["ราคา/หน่วย", cash(selected.unitMinor, selected.currency) + " " + selected.currency],
                ["ช่องทาง", methodName(selected.paymentMethod)],
                ["สถานะ", statuses[selected.status] ?? selected.status],
                ["หมายเหตุ", dash(selected.note)],
                ["รวม", cash(selected.amountMinor, selected.currency) + " " + selected.currency]
              ].map(([title, value]) => (
                <div key={title} className="min-w-0 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold text-slate-500">{title}</p>
                  <p className="mt-1 break-words text-[13px] font-bold text-slate-800">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs leading-5 text-slate-500">
              ระบบแยกผู้จัดทำและผู้อนุมัติ ไม่ลงบัญชีเดบิต–เครดิตจนกว่าเอกสารจะผ่านการอนุมัติและการโพสต์ที่ตรวจสอบแล้ว
            </p>
            {selected.status === "issued" && selected.postedJournalId ?
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                ลงบัญชีแล้ว · {selected.postedJournalId}
              </p> : null}
            {selected.status === "issued" && !selected.postedJournalId && postAllowed ? (
              <div className="grid gap-3 rounded-md border border-[#d5e4f3] bg-[#f8fbff] p-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <h3 className="text-sm font-bold text-[#1d4c78]">ลงบัญชีรายรับอื่น ๆ</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    ต้องเลือกบัญชีสินทรัพย์เดบิตและบัญชีรายได้เครดิตจริง
                    ระบบตรวจสอบสิทธิ์อนุมัติและป้องกันรายการซ้ำที่เซิร์ฟเวอร์
                  </p>
                </div>
                <div>
                  <label className={label} htmlFor="other-income-debit">เดบิต · สินทรัพย์</label>
                  <select id="other-income-debit" className={field} value={debit}
                    onChange={event => setDebit(event.target.value)}>
                    <option value="">เลือกบัญชีเดบิต</option>
                    {postAccounts.filter(item => item.type === "asset").map(item => (
                      <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="other-income-credit">เครดิต · รายได้</label>
                  <select id="other-income-credit" className={field} value={credit}
                    onChange={event => setCredit(event.target.value)}>
                    <option value="">เลือกบัญชีเครดิต</option>
                    {postAccounts.filter(item => item.type === "income").map(item => (
                      <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
            {selected.status === "issued" && !selected.postedJournalId ? (
              <div>
                <label className={label} htmlFor="other-income-void-reason">เหตุผลยกเลิก (ขั้นต่ำ 10 ตัวอักษร)</label>
                <input id="other-income-void-reason" className={field} value={reason}
                  onChange={event => setReason(event.target.value)} />
              </div>
            ) : null}
            {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" className={action} disabled={busy} onClick={() => setSelected(null)}>ปิด</button>
              {(selected.status === "draft" || selected.status === "rejected") ?
                <button type="button" className={primary} disabled={busy} onClick={() => void transition("submit")}>ส่งอนุมัติ</button> : null}
              {selected.status === "submitted" ? (
                <>
                  <button type="button" className={action} disabled={busy} onClick={() => void transition("reject")}>ส่งกลับ</button>
                  <button type="button" className={primary} disabled={busy} onClick={() => void transition("approve")}>อนุมัติ</button>
                </>
              ) : null}
              {selected.status === "approved" ?
                <button type="button" className={primary} disabled={busy} onClick={() => void transition("issue")}>ออกเอกสาร</button> : null}
              {selected.status === "issued" && !selected.postedJournalId && postAllowed ?
                <button type="button" className={primary} disabled={busy || !debit || !credit}
                  onClick={() => { void postIncome(); }}>ลงบัญชี</button> : null}
              {selected.status === "issued" && !selected.postedJournalId ?
                <button type="button" className={action} disabled={busy || reason.trim().length < 10}
                  onClick={() => void transition("void")}>ยกเลิกพร้อมเหตุผล</button> : null}
            </div>
          </div>
        ) : null}
      </FinanceDialog>
    </section>
  );
}

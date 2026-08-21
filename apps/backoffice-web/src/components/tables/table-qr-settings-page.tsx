"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import {
  DEFAULT_TABLE_QR_TTL_MINUTES,
  MAX_TABLE_QR_TTL_MINUTES,
  MIN_TABLE_QR_TTL_MINUTES,
  mergeTableQrPolicyMetadata,
  normalizeTableQrPolicyFromMetadata,
  type TableQrExpiryMode,
  type TableQrPolicy
} from "@/lib/table-qr-policy";
import type { DiningTableItem } from "@/components/tables/types";

type BranchScopeItem = {
  id: string;
  code: string;
  name: string;
  role: string;
};

type JsonBody = {
  data?: unknown;
  error?: { code?: string; message?: string } | string | null;
};

type DurationUnit = "minutes" | "hours";

async function readBody(response: Response): Promise<JsonBody | null> {
  try {
    return (await response.json()) as JsonBody;
  } catch {
    return null;
  }
}

function errorMessage(body: JsonBody | null, fallback: string): string {
  if (typeof body?.error === "string" && body.error.trim()) return body.error;
  if (body?.error && typeof body.error === "object" && body.error.message) return body.error.message;
  return fallback;
}

function policyLabel(lang: Language, policy: TableQrPolicy): string {
  if (policy.mode === "bill") return lang === "th" ? "ตามบิล · จนกว่าจะปิดบิล" : "By bill · until bill closes";
  const minutes = policy.ttl_minutes ?? DEFAULT_TABLE_QR_TTL_MINUTES;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return lang === "th" ? `ตามเวลา · ${hours} ชม.` : `Timed · ${hours} hr`;
  }
  if (minutes > 60) {
    const hours = Number((minutes / 60).toFixed(2));
    return lang === "th" ? `ตามเวลา · ${hours} ชม.` : `Timed · ${hours} hr`;
  }
  return lang === "th" ? `ตามเวลา · ${minutes} นาที` : `Timed · ${minutes} min`;
}

function durationFromMinutes(minutes: number): { unit: DurationUnit; value: string } {
  if (minutes >= 60 && minutes % 15 === 0) {
    return { unit: "hours", value: String(Number((minutes / 60).toFixed(2))) };
  }
  return { unit: "minutes", value: String(minutes) };
}

function durationToMinutes(value: string, unit: DurationUnit): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const minutes = unit === "hours" ? numeric * 60 : numeric;
  if (!Number.isInteger(minutes)) return null;
  return minutes;
}

export function TableQrSettingsPage({ lang }: { lang: Language }) {
  const [branches, setBranches] = useState<BranchScopeItem[]>([]);
  const [branchId, setBranchId] = useState("");
  const [tables, setTables] = useState<DiningTableItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [mode, setMode] = useState<TableQrExpiryMode>("time");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("hours");
  const [durationValue, setDurationValue] = useState("18");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) ?? null,
    [selectedTableId, tables]
  );

  const applySelectedPolicy = useCallback((table: DiningTableItem | null) => {
    const policy = normalizeTableQrPolicyFromMetadata(table?.metadata);
    setMode(policy.mode);
    const duration = durationFromMinutes(policy.ttl_minutes ?? DEFAULT_TABLE_QR_TTL_MINUTES);
    setDurationUnit(duration.unit);
    setDurationValue(duration.value);
  }, []);

  const loadTables = useCallback(async (targetBranchId: string) => {
    if (!targetBranchId) {
      setTables([]);
      setSelectedTableId("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/backoffice/tables?branch_id=${encodeURIComponent(targetBranchId)}`, { cache: "no-store" });
      const body = await readBody(response);
      if (!response.ok || body?.error) {
        throw new Error(errorMessage(body, lang === "th" ? "โหลดโต๊ะไม่สำเร็จ" : "Failed to load tables."));
      }
      const data = body?.data as { items?: DiningTableItem[] } | undefined;
      const items = (data?.items ?? []).filter((table) => table.is_active);
      setTables(items);
      const nextSelected = items[0] ?? null;
      setSelectedTableId(nextSelected?.id ?? "");
      applySelectedPolicy(nextSelected);
    } catch (loadError) {
      setTables([]);
      setSelectedTableId("");
      setError(loadError instanceof Error ? loadError.message : lang === "th" ? "โหลดโต๊ะไม่สำเร็จ" : "Failed to load tables.");
    } finally {
      setLoading(false);
    }
  }, [applySelectedPolicy, lang]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/backoffice/branch-scope", { cache: "no-store" });
        const body = await readBody(response);
        if (!response.ok || body?.error) {
          throw new Error(errorMessage(body, lang === "th" ? "โหลดข้อมูลสาขาไม่สำเร็จ" : "Failed to load branch scope."));
        }
        if (cancelled) return;
        const data = body?.data as { items?: BranchScopeItem[]; currentBranchId?: string | null } | undefined;
        const manageable = (data?.items ?? []).filter((branch) => branch.role === "owner" || branch.role === "manager");
        const currentBranchId = String(data?.currentBranchId ?? "");
        const nextBranchId = manageable.some((branch) => branch.id === currentBranchId)
          ? currentBranchId
          : manageable[0]?.id ?? "";
        setBranches(manageable);
        setBranchId(nextBranchId);
        if (nextBranchId) await loadTables(nextBranchId);
        else setLoading(false);
      } catch (scopeError) {
        if (!cancelled) {
          setError(scopeError instanceof Error ? scopeError.message : lang === "th" ? "โหลดข้อมูลสาขาไม่สำเร็จ" : "Failed to load branch scope.");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [lang, loadTables]);

  function selectTable(table: DiningTableItem) {
    setSelectedTableId(table.id);
    applySelectedPolicy(table);
    setError(null);
    setSuccess(null);
  }

  function applyPreset(minutes: number) {
    const duration = durationFromMinutes(minutes);
    setDurationUnit(duration.unit);
    setDurationValue(duration.value);
    setError(null);
  }

  async function savePolicy() {
    if (!selectedTable || !branchId || saving) return;
    const ttlMinutes = mode === "time" ? durationToMinutes(durationValue, durationUnit) : null;
    if (
      mode === "time" &&
      (ttlMinutes === null || ttlMinutes < MIN_TABLE_QR_TTL_MINUTES || ttlMinutes > MAX_TABLE_QR_TTL_MINUTES)
    ) {
      setError(
        lang === "th"
          ? `กำหนดเวลาได้ ${MIN_TABLE_QR_TTL_MINUTES} นาที ถึง ${MAX_TABLE_QR_TTL_MINUTES / 60} ชั่วโมง`
          : `Timed expiry must be between ${MIN_TABLE_QR_TTL_MINUTES} minutes and ${MAX_TABLE_QR_TTL_MINUTES / 60} hours.`
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/backoffice/tables/${encodeURIComponent(selectedTable.id)}/qr-policy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: branchId, mode, ttl_minutes: ttlMinutes })
      });
      const body = await readBody(response);
      if (!response.ok || body?.error) {
        throw new Error(errorMessage(body, lang === "th" ? "บันทึกการตั้งค่า QR ไม่สำเร็จ" : "Failed to save QR settings."));
      }
      const data = body?.data as { policy?: TableQrPolicy; revoked_active_sessions?: number; changed?: boolean } | undefined;
      const savedPolicy = data?.policy ?? {
        version: 1 as const,
        mode,
        ttl_minutes: mode === "time" ? ttlMinutes : null
      };
      setTables((current) => current.map((table) => table.id === selectedTable.id
        ? { ...table, metadata: mergeTableQrPolicyMetadata(table.metadata, savedPolicy) }
        : table));
      applySelectedPolicy({ ...selectedTable, metadata: mergeTableQrPolicyMetadata(selectedTable.metadata, savedPolicy) });
      const revoked = Number(data?.revoked_active_sessions ?? 0);
      setSuccess(
        lang === "th"
          ? `${data?.changed === false ? "ค่าปัจจุบันถูกต้องอยู่แล้ว" : "บันทึกแล้ว"}${revoked > 0 ? ` · ปิด QR เดิม ${revoked} รายการ กรุณาออก QR ใหม่` : ""}`
          : `${data?.changed === false ? "Settings already current" : "Saved"}${revoked > 0 ? ` · ${revoked} active QR session(s) revoked; issue a new QR` : ""}`
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : lang === "th" ? "บันทึกการตั้งค่า QR ไม่สำเร็จ" : "Failed to save QR settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-5">
      <section className="mx-auto min-h-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-600">Table QR Policy</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">{lang === "th" ? "ตั้งค่า QR โต๊ะ" : "Table QR Settings"}</h1>
            <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
              {lang === "th"
                ? "เจ้าของร้านและผู้จัดการกำหนดได้ว่า QR ของแต่ละโต๊ะจะหมดอายุตามเวลา/ชั่วโมง หรือใช้งานจนปิดบิล"
                : "Owners and managers can choose timed expiry or keep each table QR active until the bill closes."}
            </p>
          </div>
          <a href="/preview/pos/settings" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            {lang === "th" ? "‹ กลับเมนูตั้งค่า" : "‹ Back to Settings"}
          </a>
        </header>

        {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
        {success ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{success}</div> : null}

        {branches.length > 0 ? (
          <div className="mb-4 max-w-md">
            <label className="mb-1 block text-sm font-bold text-slate-700">{lang === "th" ? "สาขา" : "Branch"}</label>
            <select
              value={branchId}
              onChange={(event) => {
                const next = event.target.value;
                setBranchId(next);
                setSelectedTableId("");
                setSuccess(null);
                void loadTables(next);
              }}
              disabled={loading || saving}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
            >
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code ? `${branch.name} (${branch.code})` : branch.name}</option>)}
            </select>
          </div>
        ) : !loading ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            {lang === "th" ? "เมนูนี้อนุญาตเฉพาะเจ้าของร้านหรือผู้จัดการ" : "This menu is available to owners and managers only."}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(380px,1.1fr)]">
          <section className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="font-black text-slate-900">{lang === "th" ? "เลือกโต๊ะ" : "Choose table"}</h2>
              <p className="text-xs font-semibold text-slate-500">{lang === "th" ? `${tables.length} โต๊ะที่ใช้งาน` : `${tables.length} active table(s)`}</p>
            </div>
            <div className="max-h-[500px] overflow-y-auto p-2">
              {loading ? <p className="p-3 text-sm font-semibold text-slate-500">{lang === "th" ? "กำลังโหลด..." : "Loading..."}</p> : null}
              {!loading && tables.length === 0 ? <p className="p-3 text-sm font-semibold text-slate-500">{lang === "th" ? "ไม่พบโต๊ะในสาขานี้" : "No tables in this branch."}</p> : null}
              {tables.map((table) => {
                const policy = normalizeTableQrPolicyFromMetadata(table.metadata);
                const active = table.id === selectedTableId;
                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => selectTable(table)}
                    className={`mb-2 w-full rounded-xl border px-3 py-3 text-left transition ${active ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                  >
                    <span className="block font-black text-slate-950">{table.table_code}{table.table_name ? ` · ${table.table_name}` : ""}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-500">{policyLabel(lang, policy)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
            <h2 className="text-lg font-black text-slate-950">
              {selectedTable ? `${selectedTable.table_code}${selectedTable.table_name ? ` · ${selectedTable.table_name}` : ""}` : lang === "th" ? "ยังไม่ได้เลือกโต๊ะ" : "No table selected"}
            </h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
              {lang === "th" ? "เมื่อเปลี่ยนรูปแบบ ระบบจะยกเลิก QR เดิมของโต๊ะนี้เพื่อป้องกัน QR เก่าหลุดอายุผิดเงื่อนไข แล้วให้ออก QR ใหม่" : "Changing policy revokes the current QR so the next QR is issued with the new lifecycle."}
            </p>

            <fieldset className="mt-5 space-y-3" disabled={!selectedTable || saving}>
              <label className={`block cursor-pointer rounded-2xl border p-4 ${mode === "time" ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                <span className="flex items-center gap-2 font-black text-slate-900">
                  <input type="radio" checked={mode === "time"} onChange={() => setMode("time")} />
                  {lang === "th" ? "ตามเวลา / ชั่วโมง" : "Timed / hourly"}
                </span>
                <span className="mt-1 block pl-6 text-xs font-semibold leading-5 text-slate-500">
                  {lang === "th" ? "ฝั่งลูกค้าจะแสดงเวลาคงเหลือแบบนับถอยหลังทุกวินาที โดยช่วง 30 นาทีสุดท้ายจะแจ้งเตือนชัดเจน" : "Customer QR shows a second-by-second countdown with a prominent final-30-minute warning."}
                </span>
              </label>

              {mode === "time" ? (
                <div className="rounded-2xl border border-slate-200 p-4">
                  <label className="block text-sm font-black text-slate-800">{lang === "th" ? "กำหนดอายุ QR" : "QR lifetime"}</label>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_140px] gap-2">
                    <input
                      type="number"
                      min={durationUnit === "hours" ? 0.25 : MIN_TABLE_QR_TTL_MINUTES}
                      max={durationUnit === "hours" ? MAX_TABLE_QR_TTL_MINUTES / 60 : MAX_TABLE_QR_TTL_MINUTES}
                      step={durationUnit === "hours" ? 0.25 : 15}
                      value={durationValue}
                      onChange={(event) => setDurationValue(event.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-bold text-slate-900"
                    />
                    <select
                      value={durationUnit}
                      onChange={(event) => setDurationUnit(event.target.value as DurationUnit)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900"
                    >
                      <option value="minutes">{lang === "th" ? "นาที" : "Minutes"}</option>
                      <option value="hours">{lang === "th" ? "ชั่วโมง" : "Hours"}</option>
                    </select>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[30, 60, 90, 120, 180, 240, 360, 1080].map((minutes) => (
                      <button key={minutes} type="button" onClick={() => applyPreset(minutes)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        {minutes < 60 ? `${minutes} ${lang === "th" ? "นาที" : "min"}` : `${Number((minutes / 60).toFixed(1))} ${lang === "th" ? "ชม." : "hr"}`}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs font-semibold leading-5 text-amber-700">
                    {lang === "th" ? "เมื่อเหลือ ≤ 30 นาที ลูกค้าจะเห็นสถานะแจ้งเตือน และเมื่อ 00:00 ระบบจะล็อกหน้าจอสั่งอาหารทั้งหมดทันที" : "At ≤ 30 minutes the customer sees a warning; at 00:00 the ordering screen is fully locked."}
                  </p>
                </div>
              ) : null}

              <label className={`block cursor-pointer rounded-2xl border p-4 ${mode === "bill" ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                <span className="flex items-center gap-2 font-black text-slate-900">
                  <input type="radio" checked={mode === "bill"} onChange={() => setMode("bill")} />
                  {lang === "th" ? "ตามบิล" : "By bill"}
                </span>
                <span className="mt-1 block pl-6 text-xs font-semibold leading-5 text-slate-500">
                  {lang === "th" ? "QR ใช้งานได้ตราบใดที่บิลโต๊ะยังเปิดอยู่ และหมดสิทธิ์ทันทีเมื่อชำระ/ปิดบิล (มี safety cap 7 วัน)" : "QR stays active while the table bill is open and stops immediately on payment/close, with a 7-day safety cap."}
                </span>
              </label>
            </fieldset>

            <button
              type="button"
              onClick={() => void savePolicy()}
              disabled={!selectedTable || saving}
              className="mt-5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {saving ? (lang === "th" ? "กำลังบันทึก..." : "Saving...") : lang === "th" ? "บันทึกการตั้งค่า QR" : "Save QR settings"}
            </button>
          </section>
        </div>
      </section>
    </main>
  );
}

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
  role: "owner" | "manager" | "staff";
};

type JsonBody = {
  data?: Record<string, unknown> | null;
  error?: { code?: string; message?: string } | string | null;
};

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
  if (policy.mode === "bill") {
    return lang === "th" ? "จนกว่าจะปิดบิล" : "Until bill closes";
  }
  return lang === "th" ? `${policy.ttl_minutes ?? DEFAULT_TABLE_QR_TTL_MINUTES} นาที` : `${policy.ttl_minutes ?? DEFAULT_TABLE_QR_TTL_MINUTES} min`;
}

export function TableQrSettingsPage({ lang }: { lang: Language }) {
  const [branches, setBranches] = useState<BranchScopeItem[]>([]);
  const [branchId, setBranchId] = useState("");
  const [tables, setTables] = useState<DiningTableItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [mode, setMode] = useState<TableQrExpiryMode>("time");
  const [ttlMinutes, setTtlMinutes] = useState(String(DEFAULT_TABLE_QR_TTL_MINUTES));
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
    setTtlMinutes(String(policy.ttl_minutes ?? DEFAULT_TABLE_QR_TTL_MINUTES));
  }, []);

  const loadTables = useCallback(
    async (targetBranchId: string) => {
      if (!targetBranchId) {
        setTables([]);
        setSelectedTableId("");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/backoffice/tables?branch_id=${encodeURIComponent(targetBranchId)}`, {
          cache: "no-store"
        });
        const body = await readBody(response);
        if (!response.ok || body?.error) {
          throw new Error(errorMessage(body, lang === "th" ? "โหลดโต๊ะไม่สำเร็จ" : "Failed to load tables."));
        }
        const items = (((body?.data as { items?: DiningTableItem[] } | undefined)?.items ?? []) as DiningTableItem[]).filter(
          (table) => table.is_active
        );
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
    },
    [applySelectedPolicy, lang]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadScope() {
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
        const items = (data?.items ?? []).filter((branch) => branch.role === "owner" || branch.role === "manager");
        const currentBranchId = String(data?.currentBranchId ?? "");
        const nextBranchId = items.some((branch) => branch.id === currentBranchId) ? currentBranchId : items[0]?.id ?? "";
        setBranches(items);
        setBranchId(nextBranchId);
        if (nextBranchId) {
          await loadTables(nextBranchId);
        } else {
          setLoading(false);
        }
      } catch (scopeError) {
        if (!cancelled) {
          setError(scopeError instanceof Error ? scopeError.message : lang === "th" ? "โหลดข้อมูลสาขาไม่สำเร็จ" : "Failed to load branch scope.");
          setLoading(false);
        }
      }
    }
    void loadScope();
    return () => {
      cancelled = true;
    };
  }, [lang, loadTables]);

  function selectTable(table: DiningTableItem) {
    setSelectedTableId(table.id);
    applySelectedPolicy(table);
    setError(null);
    setSuccess(null);
  }

  async function savePolicy() {
    if (!selectedTable || !branchId || saving) return;
    const ttl = Number(ttlMinutes);
    if (mode === "time" && (!Number.isInteger(ttl) || ttl < MIN_TABLE_QR_TTL_MINUTES || ttl > MAX_TABLE_QR_TTL_MINUTES)) {
      setError(
        lang === "th"
          ? `กำหนดเวลาได้ ${MIN_TABLE_QR_TTL_MINUTES}-${MAX_TABLE_QR_TTL_MINUTES} นาที`
          : `Timed expiry must be ${MIN_TABLE_QR_TTL_MINUTES}-${MAX_TABLE_QR_TTL_MINUTES} minutes.`
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
        body: JSON.stringify({
          branch_id: branchId,
          mode,
          ttl_minutes: mode === "time" ? ttl : null
        })
      });
      const body = await readBody(response);
      if (!response.ok || body?.error) {
        throw new Error(errorMessage(body, lang === "th" ? "บันทึกการตั้งค่า QR ไม่สำเร็จ" : "Failed to save QR settings."));
      }
      const data = body?.data as
        | { policy?: TableQrPolicy; revoked_active_sessions?: number; changed?: boolean }
        | undefined;
      const savedPolicy = data?.policy ?? { version: 1 as const, mode, ttl_minutes: mode === "time" ? ttl : null };
      setTables((current) =>
        current.map((table) =>
          table.id === selectedTable.id
            ? { ...table, metadata: mergeTableQrPolicyMetadata(table.metadata, savedPolicy) }
            : table
        )
      );
      applySelectedPolicy({
        ...selectedTable,
        metadata: mergeTableQrPolicyMetadata(selectedTable.metadata, savedPolicy)
      });
      const revoked = Number(data?.revoked_active_sessions ?? 0);
      setSuccess(
        lang === "th"
          ? `${data?.changed === false ? "ค่าปัจจุบันถูกต้องอยู่แล้ว" : "บันทึกแล้ว"}${revoked > 0 ? ` • ปิด QR เดิม ${revoked} รายการ กรุณาออก QR ใหม่` : ""}`
          : `${data?.changed === false ? "Settings already current" : "Saved"}${revoked > 0 ? ` • ${revoked} active QR session(s) revoked; issue a new QR` : ""}`
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : lang === "th" ? "บันทึกการตั้งค่า QR ไม่สำเร็จ" : "Failed to save QR settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-5">
      <section className="mx-auto min-h-full max-w-6xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-950">{lang === "th" ? "ตั้งค่า QR โต๊ะ" : "Table QR Settings"}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {lang === "th"
                ? "กำหนดอายุ QR แยกแต่ละโต๊ะ โดยไม่เปลี่ยนเส้นทางออเดอร์หรือบิลเดิม"
                : "Configure QR lifetime per table without changing the existing order or bill flow."}
            </p>
          </div>
          <a href="/preview/pos/more" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            {lang === "th" ? "< กลับเมนูเพิ่มเติม" : "< Back to More"}
          </a>
        </header>

        {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
        {success ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{success}</div> : null}

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
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code ? `${branch.name} (${branch.code})` : branch.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.1fr)]">
          <section className="rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="font-black text-slate-900">{lang === "th" ? "เลือกโต๊ะ" : "Choose table"}</h2>
              <p className="text-xs font-semibold text-slate-500">{lang === "th" ? `${tables.length} โต๊ะที่ใช้งาน` : `${tables.length} active table(s)`}</p>
            </div>
            <div className="max-h-[460px] overflow-y-auto p-2">
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
                    className={`mb-2 w-full rounded-lg border px-3 py-3 text-left ${active ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                  >
                    <span className="block font-black text-slate-950">{table.table_code}{table.table_name ? ` • ${table.table_name}` : ""}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-500">{policyLabel(lang, policy)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h2 className="text-lg font-black text-slate-950">
              {selectedTable ? `${selectedTable.table_code}${selectedTable.table_name ? ` • ${selectedTable.table_name}` : ""}` : lang === "th" ? "ยังไม่ได้เลือกโต๊ะ" : "No table selected"}
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {lang === "th" ? "เมื่อเปลี่ยน policy ระบบจะยกเลิก QR เดิมของโต๊ะนี้ และต้องออก QR ใหม่" : "Changing policy revokes the table's current QR so a new QR must be issued."}
            </p>

            <fieldset className="mt-5 space-y-3" disabled={!selectedTable || saving}>
              <label className={`block rounded-lg border p-3 ${mode === "time" ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                <span className="flex items-center gap-2 font-black text-slate-900">
                  <input type="radio" checked={mode === "time"} onChange={() => setMode("time")} />
                  {lang === "th" ? "หมดอายุตามเวลา" : "Expire by time"}
                </span>
                <span className="mt-1 block pl-6 text-xs font-semibold text-slate-500">
                  {lang === "th" ? "เหมาะกับบุฟเฟ่ต์หรือร้านที่จำกัดเวลาการสั่ง" : "Good for buffet or time-limited ordering."}
                </span>
              </label>

              {mode === "time" ? (
                <div className="rounded-lg border border-slate-200 p-3">
                  <label className="block text-sm font-black text-slate-800">{lang === "th" ? "อายุ QR (นาที)" : "QR lifetime (minutes)"}</label>
                  <input
                    type="number"
                    min={MIN_TABLE_QR_TTL_MINUTES}
                    max={MAX_TABLE_QR_TTL_MINUTES}
                    step={15}
                    value={ttlMinutes}
                    onChange={(event) => setTtlMinutes(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-bold text-slate-900"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[60, 90, 120, 180, 360, 1080].map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => setTtlMinutes(String(minutes))}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        {minutes}m
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className={`block rounded-lg border p-3 ${mode === "bill" ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                <span className="flex items-center gap-2 font-black text-slate-900">
                  <input type="radio" checked={mode === "bill"} onChange={() => setMode("bill")} />
                  {lang === "th" ? "หมดอายุเมื่อปิดบิล" : "Expire when bill closes"}
                </span>
                <span className="mt-1 block pl-6 text-xs font-semibold text-slate-500">
                  {lang === "th"
                    ? "QR ใช้ได้ระหว่างบิลโต๊ะยังเปิดอยู่ และมี hard safety cap 7 วันเพื่อความปลอดภัย"
                    : "QR remains usable while the table bill is open, with a 7-day hard safety cap."}
                </span>
              </label>
            </fieldset>

            <button
              type="button"
              onClick={() => void savePolicy()}
              disabled={!selectedTable || saving}
              className="mt-5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {saving ? (lang === "th" ? "กำลังบันทึก..." : "Saving...") : lang === "th" ? "บันทึกการตั้งค่า QR" : "Save QR settings"}
            </button>
          </section>
        </div>
      </section>
    </main>
  );
}

"use client";

import { FormEvent, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type BranchScopeItem = {
  id: string;
  code: string;
  name: string;
  role: "owner" | "manager" | "staff";
};

type ZoneItem = {
  id: string;
  zone_name: string;
};

type TableRow = {
  branch_id?: string | null;
  table_code?: string | null;
};

type BulkNameMode = "prefix_number" | "table_number" | "number";

type BulkForm = {
  branch_id: string;
  zone_id: string;
  count: string;
  start_number: string;
  prefix: string;
  capacity: string;
  name_mode: BulkNameMode;
};

const initialForm: BulkForm = {
  branch_id: "",
  zone_id: "",
  count: "5",
  start_number: "1",
  prefix: "",
  capacity: "4",
  name_mode: "prefix_number"
};

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function findNextNumber(rows: TableRow[]) {
  let maxNumber = 0;
  for (const row of rows) {
    const raw = String(row.table_code ?? "").trim();
    const groups = raw.match(/\d+/g);
    const last = groups?.[groups.length - 1];
    if (!last) continue;
    const value = Number(last);
    if (Number.isInteger(value) && value > maxNumber) maxNumber = value;
  }
  return maxNumber + 1;
}

export function TableBulkCreateButton({
  lang = "th",
  defaultBranchId
}: {
  lang?: Language;
  defaultBranchId?: string | null;
}) {
  const isTh = lang === "th";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchScopeItem[]>([]);
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [form, setForm] = useState<BulkForm>(initialForm);

  const copy = isTh
    ? {
        button: "+ เพิ่มหลายโต๊ะ",
        title: "เพิ่มโต๊ะหลายโต๊ะ",
        subtitle: "สร้างโต๊ะอย่างน้อย 5 โต๊ะในครั้งเดียว โดยระบบตรวจรายการซ้ำก่อนบันทึก",
        branch: "สาขา",
        zone: "โซน",
        unassigned: "ไม่ระบุโซน",
        count: "จำนวนโต๊ะ",
        start: "เลขเริ่มต้น",
        prefix: "Prefix",
        capacity: "จำนวนที่นั่งต่อโต๊ะ",
        naming: "รูปแบบชื่อโต๊ะ",
        namePrefix: "ใช้ Prefix + เลข",
        nameTable: "โต๊ะ {เลข}",
        nameNumber: "ใช้เลขอย่างเดียว",
        preview: "ตัวอย่างที่จะสร้าง",
        cancel: "ยกเลิก",
        create: "สร้างโต๊ะ",
        creating: "กำลังสร้าง...",
        noBranch: "ไม่พบสาขาที่คุณมีสิทธิ์จัดการโต๊ะ",
        loadFailed: "โหลดข้อมูลสำหรับเพิ่มหลายโต๊ะไม่สำเร็จ",
        createFailed: "เพิ่มโต๊ะหลายโต๊ะไม่สำเร็จ"
      }
    : {
        button: "+ Bulk add tables",
        title: "Bulk add tables",
        subtitle: "Create at least 5 tables in one operation. Duplicates are checked before saving.",
        branch: "Branch",
        zone: "Zone",
        unassigned: "Unassigned",
        count: "Table count",
        start: "Start number",
        prefix: "Prefix",
        capacity: "Seats per table",
        naming: "Table name format",
        namePrefix: "Prefix + number",
        nameTable: "Table {number}",
        nameNumber: "Number only",
        preview: "Preview",
        cancel: "Cancel",
        create: "Create tables",
        creating: "Creating...",
        noBranch: "No manageable branch is available.",
        loadFailed: "Failed to load bulk table setup.",
        createFailed: "Failed to bulk create tables."
      };

  const count = Math.max(0, Math.trunc(Number(form.count) || 0));
  const startNumber = Math.max(1, Math.trunc(Number(form.start_number) || 1));
  const normalizedPrefix = form.prefix.trim();

  const preview = useMemo(() => {
    const visibleCount = Math.min(5, Math.max(0, count));
    return Array.from({ length: visibleCount }, (_, index) => {
      const number = startNumber + index;
      const code = `${normalizedPrefix}${number}`;
      let name = code;
      if (form.name_mode === "table_number") name = isTh ? `โต๊ะ ${number}` : `Table ${number}`;
      if (form.name_mode === "number") name = String(number);
      return { code, name };
    });
  }, [count, form.name_mode, isTh, normalizedPrefix, startNumber]);

  async function loadBranchData(branchId: string) {
    if (!branchId) {
      setZones([]);
      return;
    }
    const encoded = encodeURIComponent(branchId);
    const [zonesResponse, tablesResponse] = await Promise.all([
      fetch(`/api/backoffice/table-zones?branch_id=${encoded}`, { cache: "no-store" }),
      fetch(`/api/backoffice/tables?branch_id=${encoded}`, { cache: "no-store" })
    ]);
    const [zonesBody, tablesBody] = await Promise.all([readJson(zonesResponse), readJson(tablesResponse)]);
    if (!zonesResponse.ok || zonesBody?.error || !tablesResponse.ok || tablesBody?.error) {
      throw new Error(zonesBody?.error?.message ?? tablesBody?.error?.message ?? copy.loadFailed);
    }
    setZones((zonesBody?.data?.items ?? []) as ZoneItem[]);
    const tableRows = (tablesBody?.data?.items ?? []) as TableRow[];
    setForm((current) => ({
      ...current,
      branch_id: branchId,
      zone_id: "",
      start_number: String(findNextNumber(tableRows))
    }));
  }

  async function openModal() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setForm(initialForm);
    try {
      const response = await fetch("/api/backoffice/branch-scope", { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? copy.loadFailed);
      const manageable = ((body?.data?.items ?? []) as BranchScopeItem[]).filter(
        (branch) => branch.role === "owner" || branch.role === "manager"
      );
      setBranches(manageable);
      if (manageable.length === 0) {
        setError(copy.noBranch);
        return;
      }
      const currentBranchId = String(body?.data?.currentBranchId ?? "");
      const preferred =
        manageable.find((branch) => branch.id === defaultBranchId)?.id ??
        manageable.find((branch) => branch.id === currentBranchId)?.id ??
        manageable[0].id;
      await loadBranchData(preferred);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    if (!form.branch_id) {
      setError(copy.noBranch);
      return;
    }
    if (!Number.isInteger(count) || count < 5 || count > 100) {
      setError(isTh ? "จำนวนโต๊ะต้องอยู่ระหว่าง 5 ถึง 100 โต๊ะ" : "Table count must be between 5 and 100.");
      return;
    }
    if (!Number.isInteger(startNumber) || startNumber < 1) {
      setError(isTh ? "เลขเริ่มต้นต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป" : "Start number must be an integer of 1 or greater.");
      return;
    }
    const capacity = Math.trunc(Number(form.capacity) || 0);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 999) {
      setError(isTh ? "จำนวนที่นั่งต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป" : "Capacity must be a positive integer.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/backoffice/tables/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_id: form.branch_id,
          zone_id: form.zone_id || null,
          count,
          start_number: startNumber,
          prefix: normalizedPrefix,
          capacity,
          name_mode: form.name_mode,
          locale: lang
        })
      });
      const body = await readJson(response);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? copy.createFailed);
      }
      setOpen(false);
      window.location.reload();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : copy.createFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void openModal()}
        className="table-bulk-create-trigger"
        style={{
          minHeight: 34,
          border: "1px solid #2563eb",
          borderRadius: 8,
          background: "#eff6ff",
          color: "#1d4ed8",
          padding: "0 12px",
          fontSize: 12,
          fontWeight: 800,
          cursor: "pointer"
        }}
      >
        {copy.button}
      </button>

      {open ? (
        <div
          role="presentation"
          onClick={() => (!saving ? setOpen(false) : null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 120,
            display: "grid",
            placeItems: "center",
            background: "rgba(15, 23, 42, 0.55)",
            padding: 16
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={copy.title}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(620px, calc(100vw - 32px))",
              maxHeight: "calc(100vh - 32px)",
              overflow: "auto",
              borderRadius: 14,
              border: "1px solid #dbe3ef",
              background: "#fff",
              padding: 16,
              boxShadow: "0 24px 60px rgba(15, 23, 42, 0.24)"
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 20 }}>{copy.title}</h3>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>{copy.subtitle}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={saving} style={{ minWidth: 36, minHeight: 36 }}>
                ×
              </button>
            </header>

            {loading ? <p style={{ marginTop: 16 }}>{isTh ? "กำลังโหลด..." : "Loading..."}</p> : null}

            {!loading ? (
              <form onSubmit={submit} style={{ marginTop: 16, display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
                  {copy.branch}
                  <select
                    value={form.branch_id}
                    disabled={saving}
                    onChange={(event) => {
                      const branchId = event.target.value;
                      setForm((current) => ({ ...current, branch_id: branchId }));
                      void loadBranchData(branchId).catch((loadError) => {
                        setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
                      });
                    }}
                    style={{ minHeight: 40, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px", background: "#fff" }}
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.code ? `${branch.name} (${branch.code})` : branch.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
                    {copy.zone}
                    <select
                      value={form.zone_id}
                      onChange={(event) => setForm((current) => ({ ...current, zone_id: event.target.value }))}
                      style={{ minHeight: 40, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px", background: "#fff" }}
                    >
                      <option value="">{copy.unassigned}</option>
                      {zones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.zone_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
                    {copy.capacity}
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={form.capacity}
                      onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))}
                      style={{ minHeight: 40, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px" }}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
                    {copy.count}
                    <input
                      type="number"
                      min={5}
                      max={100}
                      value={form.count}
                      onChange={(event) => setForm((current) => ({ ...current, count: event.target.value }))}
                      style={{ minHeight: 40, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
                    {copy.start}
                    <input
                      type="number"
                      min={1}
                      value={form.start_number}
                      onChange={(event) => setForm((current) => ({ ...current, start_number: event.target.value }))}
                      style={{ minHeight: 40, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
                    {copy.prefix}
                    <input
                      value={form.prefix}
                      maxLength={20}
                      onChange={(event) => setForm((current) => ({ ...current, prefix: event.target.value }))}
                      placeholder="A / R / VIP"
                      style={{ minHeight: 40, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px" }}
                    />
                  </label>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: -4 }}>
                  {[5, 10, 20].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, count: String(preset) }))}
                      style={{
                        minHeight: 32,
                        border: "1px solid #cbd5e1",
                        borderRadius: 8,
                        background: Number(form.count) === preset ? "#dbeafe" : "#fff",
                        color: "#1e3a8a",
                        padding: "0 12px",
                        fontWeight: 800
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
                  {copy.naming}
                  <select
                    value={form.name_mode}
                    onChange={(event) => setForm((current) => ({ ...current, name_mode: event.target.value as BulkNameMode }))}
                    style={{ minHeight: 40, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px", background: "#fff" }}
                  >
                    <option value="prefix_number">{copy.namePrefix}</option>
                    <option value="table_number">{copy.nameTable}</option>
                    <option value="number">{copy.nameNumber}</option>
                  </select>
                </label>

                <div style={{ border: "1px solid #dbeafe", borderRadius: 10, background: "#f8fbff", padding: 12 }}>
                  <strong style={{ display: "block", fontSize: 13 }}>{copy.preview}</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {preview.map((item) => (
                      <span key={item.code} style={{ borderRadius: 999, background: "#e0f2fe", color: "#075985", padding: "5px 9px", fontSize: 12, fontWeight: 800 }}>
                        {item.code}{item.name !== item.code ? ` · ${item.name}` : ""}
                      </span>
                    ))}
                  </div>
                  <p style={{ margin: "8px 0 0", color: "#475569", fontSize: 12 }}>
                    {isTh ? `กำลังจะสร้างทั้งหมด ${count || 0} โต๊ะ` : `Creating ${count || 0} tables in this batch.`}
                  </p>
                </div>

                {error ? (
                  <p style={{ margin: 0, border: "1px solid #fed7aa", borderRadius: 8, background: "#fff7ed", color: "#9a3412", padding: "9px 10px", fontSize: 13, fontWeight: 700 }}>
                    {error}
                  </p>
                ) : null}

                <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setOpen(false)} disabled={saving} style={{ minHeight: 40, padding: "0 14px" }}>
                    {copy.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={saving || branches.length === 0}
                    style={{ minHeight: 40, border: 0, borderRadius: 8, background: "#2563eb", color: "#fff", padding: "0 16px", fontWeight: 900 }}
                  >
                    {saving ? copy.creating : copy.create}
                  </button>
                </footer>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

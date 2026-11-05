"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchWithTimeout } from "@/lib/client-fetch";

export type IngredientUnitOption = {
  id: string;
  unit_value: string;
  label_th: string;
  label_en: string;
  calculation_kind: "weight" | "count";
  is_system: boolean;
  is_active: boolean;
  usage_count?: number;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type Props = {
  th: boolean;
  branchId: string;
  units: IngredientUnitOption[];
  storageReady: boolean;
  canManage: boolean;
  onReload: () => Promise<void> | void;
};

export function IngredientUnitManagePopupButton({
  th,
  branchId,
  units,
  storageReady,
  canManage,
  onReload
}: Props) {
  const [open, setOpen] = useState(false);
  const [newRowOpen, setNewRowOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const closeTimerRef = useRef<number | null>(null);

  const sortedUnits = useMemo(
    () => [...units].filter((row) => row.is_active).sort((a, b) => {
      if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
      return (a.label_th || a.label_en).localeCompare(b.label_th || b.label_en, "th");
    }),
    [units]
  );

  function resetTransientState() {
    setNewRowOpen(false);
    setNewName("");
    setEditingId(null);
    setEditingName("");
    setBusyId(null);
    setError("");
    setSuccess("");
  }

  function closePopup(force = false) {
    if (busyId && !force) return;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(false);
    resetTransientState();
  }

  function showSavedAndClose(message: string) {
    setSuccess(message);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => closePopup(true), 650);
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyId) closePopup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busyId]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  async function post(body: Record<string, unknown>) {
    const response = await fetchWithTimeout("/api/backoffice/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, branch_id: branchId })
    }, 15000);
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error?.message ?? (th ? "บันทึกไม่สำเร็จ" : "Save failed."));
    }
  }

  async function createUnit() {
    const name = newName.trim();
    if (!name) {
      setError(th ? "กรุณาระบุชื่อหน่วย" : "Unit name is required.");
      return;
    }
    setError("");
    setBusyId("new");
    try {
      await post({ action: "create_ingredient_unit", name });
      await onReload();
      showSavedAndClose(th ? "บันทึกหน่วยวัตถุดิบเรียบร้อยแล้ว" : "Ingredient unit saved.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : th ? "บันทึกไม่สำเร็จ" : "Save failed.");
      setBusyId(null);
    }
  }

  async function renameUnit(row: IngredientUnitOption) {
    const name = editingName.trim();
    if (!name) {
      setError(th ? "กรุณาระบุชื่อหน่วย" : "Unit name is required.");
      return;
    }
    setError("");
    setBusyId(row.id);
    try {
      await post({ action: "rename_ingredient_unit", unit_id: row.id, name });
      await onReload();
      showSavedAndClose(th ? "แก้ไขหน่วยวัตถุดิบเรียบร้อยแล้ว" : "Ingredient unit updated.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : th ? "แก้ไขไม่สำเร็จ" : "Update failed.");
      setBusyId(null);
    }
  }

  async function deleteUnit(row: IngredientUnitOption) {
    setError("");
    setBusyId(row.id);
    try {
      await post({ action: "delete_ingredient_unit", unit_id: row.id });
      await onReload();
      showSavedAndClose(
        (row.usage_count ?? 0) > 0
          ? th
            ? "หน่วยถูกซ่อนจากรายการใหม่แล้ว โดยวัตถุดิบเดิมยังใช้งานต่อได้"
            : "Unit hidden for new selections; existing ingredients remain valid."
          : th
            ? "ลบหน่วยวัตถุดิบเรียบร้อยแล้ว"
            : "Ingredient unit deleted."
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : th ? "ลบไม่สำเร็จ" : "Delete failed.");
      setBusyId(null);
    }
  }

  const button = (
    <button
      type="button"
      onClick={() => {
        resetTransientState();
        setOpen(true);
      }}
      disabled={!canManage}
      className="inline-flex min-h-8 items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-700 shadow-sm hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {th ? "เพิ่มหน่วยวัตถุดิบ" : "Ingredient Units"}
    </button>
  );

  if (!open) return button;

  return (
    <>
      {button}
      {createPortal(
        <div
          className="fixed inset-0 z-[220] grid place-items-center bg-slate-900/55 p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closePopup();
          }}
        >
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">
                  {th ? "จัดการหน่วยวัตถุดิบ" : "Manage Ingredient Units"}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {th
                    ? "เพิ่ม แก้ไข หรือลบชื่อหน่วยได้ หน่วยที่เพิ่มเองจะใช้เป็นหน่วยนับเพื่อให้สูตรและสต๊อกคำนวณปลอดภัย"
                    : "Add, rename or remove units. Customer-created units are treated as count units for safe stock calculations."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => closePopup()}
                disabled={Boolean(busyId)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {th ? "ปิด" : "Close"}
              </button>
            </div>

            {!storageReady ? (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                {th ? "ระบบจัดเก็บหน่วยยังไม่พร้อม กรุณารีเฟรชหลังอัปเดตฐานข้อมูล" : "Unit storage is not ready yet. Refresh after the database update."}
              </p>
            ) : null}

            {error ? (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>
            ) : null}
            {success ? (
              <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{success}</p>
            ) : null}

            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setNewRowOpen(true);
                  setNewName("");
                  setEditingId(null);
                  setError("");
                }}
                disabled={Boolean(busyId) || !storageReady}
                className="inline-flex min-h-9 items-center rounded-lg border border-violet-600 bg-violet-600 px-3 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                + {th ? "เพิ่มหน่วย" : "Add Unit"}
              </button>
            </div>

            <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "หน่วย" : "Unit"}</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "ประเภท" : "Type"}</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-center text-xs font-bold text-slate-600">{th ? "ใช้งาน" : "Used"}</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">{th ? "จัดการ" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {newRowOpen ? (
                    <tr className="bg-violet-50/60">
                      <td className="border-b border-slate-100 px-3 py-2">
                        <input
                          value={newName}
                          onChange={(event) => setNewName(event.target.value)}
                          autoFocus
                          maxLength={80}
                          placeholder={th ? "เช่น กล่อง, ขวด, แพ็ค" : "e.g. box, bottle, pack"}
                          className="min-h-9 w-full rounded-lg border border-violet-300 bg-white px-3 text-sm"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-600">{th ? "หน่วยนับ" : "Count unit"}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-center text-sm text-slate-500">0</td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => { setNewRowOpen(false); setNewName(""); setError(""); }} disabled={Boolean(busyId)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50">{th ? "ยกเลิก" : "Cancel"}</button>
                          <button type="button" onClick={() => void createUnit()} disabled={Boolean(busyId)} className="rounded-lg border border-violet-600 bg-violet-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busyId === "new" ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึก" : "Save"}</button>
                        </div>
                      </td>
                    </tr>
                  ) : null}

                  {sortedUnits.map((row) => (
                    <tr key={row.id}>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {editingId === row.id ? (
                          <input
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            autoFocus
                            maxLength={80}
                            className="min-h-9 w-full rounded-lg border border-blue-300 bg-white px-3 text-sm"
                          />
                        ) : (
                          <span className="text-sm font-semibold text-slate-900">{th ? row.label_th : row.label_en}</span>
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-600">
                        {row.is_system
                          ? th ? "มาตรฐาน" : "System"
                          : th ? "หน่วยนับที่เพิ่มเอง" : "Custom count"}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-center text-sm font-bold text-slate-700">{row.usage_count ?? 0}</td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        <div className="flex justify-end gap-2">
                          {editingId === row.id ? (
                            <>
                              <button type="button" onClick={() => { setEditingId(null); setEditingName(""); setError(""); }} disabled={Boolean(busyId)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50">{th ? "ยกเลิก" : "Cancel"}</button>
                              <button type="button" onClick={() => void renameUnit(row)} disabled={Boolean(busyId)} className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busyId === row.id ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึก" : "Save"}</button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(row.id);
                                  setEditingName(th ? row.label_th : row.label_en);
                                  setNewRowOpen(false);
                                  setError("");
                                }}
                                disabled={Boolean(busyId)}
                                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50"
                              >
                                {th ? "แก้ไข" : "Edit"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteUnit(row)}
                                disabled={Boolean(busyId)}
                                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50"
                              >
                                {busyId === row.id ? "..." : th ? "ลบ" : "Delete"}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {sortedUnits.length === 0 && !newRowOpen ? (
                    <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">{th ? "ยังไม่มีหน่วยวัตถุดิบ" : "No ingredient units."}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

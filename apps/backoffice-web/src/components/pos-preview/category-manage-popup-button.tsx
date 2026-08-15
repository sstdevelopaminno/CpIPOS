"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mergeCategoryCountItems, mergeCategoryNames, normalizeCategoryKey, normalizeCategoryName } from "@/lib/pos/category-normalization";

type CategoryListItem = {
  name: string;
  productCount: number;
};

type Props = {
  th: boolean;
  categories: CategoryListItem[];
  branchId: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

const CATEGORY_FALLBACK_EVENT = "pos-product-categories-updated";

function storageKey(branchId: string) {
  return `pos_product_categories_v1:${branchId}`;
}

function readStoredCategoryNames(branchId: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(branchId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return mergeCategoryNames(parsed);
  } catch {
    return [];
  }
}

function writeStoredCategoryNames(branchId: string, names: string[]) {
  if (typeof window === "undefined") return;
  const uniqueNames = mergeCategoryNames(names);
  window.localStorage.setItem(storageKey(branchId), JSON.stringify(uniqueNames));
  window.dispatchEvent(new CustomEvent(CATEGORY_FALLBACK_EVENT, { detail: { branchId, names: uniqueNames } }));
}

export function CategoryManagePopupButton({ th, categories, branchId }: Props) {
  const router = useRouter();
  const initialRows = useMemo(
    () =>
      mergeCategoryCountItems(categories, th ? "th" : "en").map((item) => ({
        id: createId(),
        name: item.name,
        productCount: item.productCount
      })),
    [categories, th]
  );

  const [rows, setRows] = useState(initialRows);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [errorText, setErrorText] = useState("");
  const [busyAction, setBusyAction] = useState<{ type: "create" | "rename" | "delete" } | null>(null);
  const busy = busyAction !== null;
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const merged = mergeCategoryCountItems(
      [
        ...initialRows.map((row) => ({ name: row.name, productCount: row.productCount })),
        ...readStoredCategoryNames(branchId).map((name) => ({ name, productCount: 0 }))
      ],
      th ? "th" : "en"
    ).map((item) => ({ id: createId(), name: item.name, productCount: item.productCount }));
    setRows(merged);
  }, [branchId, initialRows, th]);

  function openPopup() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
    window.requestAnimationFrame(() => setVisible(true));
  }

  function closePopup() {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setEditingId(null);
      setEditingName("");
      setErrorText("");
    }, 180);
  }

  function isDuplicateName(value: string, excludeId?: string) {
    const key = normalizeCategoryKey(value);
    return rows.some((row) => row.id !== excludeId && normalizeCategoryKey(row.name) === key);
  }

  async function submitCategoryAction<T>(payload: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, branch_id: branchId }),
        signal: controller.signal
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
      if (!response.ok || !body || body.error) {
        throw new Error(body?.error?.message ?? "Request failed.");
      }
      return body.data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(th ? "ระบบตอบสนองช้า กรุณาลองใหม่" : "Request timed out. Please try again.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function addCategory() {
    const value = newName.trim();
    if (!value) {
      setErrorText(th ? "กรุณากรอกชื่อหมวดหมู่" : "Please enter category name.");
      return;
    }
    if (isDuplicateName(value)) {
      setErrorText(th ? "มีหมวดหมู่นี้แล้ว" : "This category already exists.");
      return;
    }

    setBusyAction({ type: "create" });
    try {
      const result = await submitCategoryAction<{ category?: { name?: string; productCount?: number }; persisted?: boolean }>({
        action: "create_category",
        name: value
      });
      const nextName = normalizeCategoryName(result?.category?.name ?? value);
      writeStoredCategoryNames(branchId, [...readStoredCategoryNames(branchId), nextName]);
      setRows((prev) =>
        mergeCategoryCountItems(
          [{ name: nextName, productCount: Number(result?.category?.productCount ?? 0) }, ...prev],
          th ? "th" : "en"
        ).map((item) => ({ id: createId(), name: item.name, productCount: item.productCount }))
      );
      setNewName("");
      setErrorText("");
      if (result?.persisted) {
        router.refresh();
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : th ? "เพิ่มหมวดหมู่ไม่สำเร็จ" : "Failed to add category.");
    } finally {
      setBusyAction(null);
    }
  }

  function startEdit(id: string, currentName: string) {
    setEditingId(id);
    setEditingName(currentName);
    setErrorText("");
  }

  async function saveEdit() {
    if (!editingId) return;
    const value = editingName.trim();
    const currentRow = rows.find((row) => row.id === editingId);
    if (!value) {
      setErrorText(th ? "ชื่อหมวดหมู่ห้ามว่าง" : "Category name cannot be empty.");
      return;
    }
    if (isDuplicateName(value, editingId)) {
      setErrorText(th ? "มีหมวดหมู่นี้แล้ว" : "This category already exists.");
      return;
    }
    if (!currentRow) return;

    setBusyAction({ type: "rename" });
    try {
      const result = await submitCategoryAction<{ persisted?: boolean }>({ action: "rename_category", old_name: currentRow.name, name: value });
      writeStoredCategoryNames(
        branchId,
        readStoredCategoryNames(branchId).map((name) => (normalizeCategoryKey(name) === normalizeCategoryKey(currentRow.name) ? value : name))
      );
      setRows((prev) => prev.map((row) => (row.id === editingId ? { ...row, name: value } : row)));
      setEditingId(null);
      setEditingName("");
      setErrorText("");
      if (result?.persisted !== false) {
        router.refresh();
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : th ? "แก้ไขหมวดหมู่ไม่สำเร็จ" : "Failed to update category.");
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteCategory(id: string) {
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    if (row.productCount > 0) {
      setErrorText(th ? "ลบไม่ได้ เพราะยังมีสินค้าในหมวดนี้" : "Cannot delete a category that still has products.");
      return;
    }
    setBusyAction({ type: "delete" });
    try {
      const result = await submitCategoryAction<{ persisted?: boolean }>({ action: "delete_category", name: row.name });
      writeStoredCategoryNames(
        branchId,
        readStoredCategoryNames(branchId).filter((name) => normalizeCategoryKey(name) !== normalizeCategoryKey(row.name))
      );
      setRows((prev) => prev.filter((item) => item.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setEditingName("");
      }
      setErrorText("");
      if (result?.persisted !== false) {
        router.refresh();
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : th ? "ลบหมวดหมู่ไม่สำเร็จ" : "Failed to delete category.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPopup}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
      >
        {th ? "แก้ไขหมวดหมู่" : "Edit Categories"}
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-[135] grid place-items-center p-4 transition-all duration-200 ${
            visible ? "bg-slate-900/55 opacity-100" : "bg-slate-900/0 opacity-0"
          }`}
          onClick={closePopup}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl transition-all duration-200 ${
              visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{th ? "เพิ่มและแก้ไขหมวดหมู่" : "Add & Edit Categories"}</h3>
                <p className="text-xs text-slate-500">
                  {th ? "เพิ่มหมวดหมู่ใหม่ หรือแก้ไขและลบหมวดหมู่ที่มีอยู่" : "Add new category, or edit and delete existing categories."}
                </p>
              </div>
              <button
                type="button"
                onClick={closePopup}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ปิด" : "Close"}
              </button>
            </div>

            <div className="mb-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                disabled={busy}
                placeholder={th ? "ชื่อหมวดหมู่ใหม่" : "New category name"}
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-blue-200 focus:ring-2"
              />
              <button
                type="button"
                onClick={() => void addCategory()}
                disabled={busy}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)] hover:bg-blue-700"
              >
                {busyAction?.type === "create" ? "..." : th ? "+ เพิ่มหมวดหมู่" : "+ Add Category"}
              </button>
            </div>

            {errorText ? <p className="mb-2 text-sm font-semibold text-red-600">{errorText}</p> : null}

            <div className="max-h-[56vh] overflow-y-auto rounded-xl border border-slate-200">
              {rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">{th ? "ยังไม่มีหมวดหมู่" : "No categories yet."}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const isEditing = editingId === row.id;
                    return (
                      <li key={row.id} className="grid gap-2 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                        <div className="min-w-0">
                          {isEditing ? (
                            <input
                              value={editingName}
                              onChange={(event) => setEditingName(event.target.value)}
                              disabled={busy}
                              className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-blue-200 focus:ring-2"
                            />
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-bold text-slate-900">{row.name}</p>
                              <span className="inline-flex min-h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-600">
                                {th ? `${row.productCount} สินค้า` : `${row.productCount} products`}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void saveEdit()}
                                disabled={busy}
                                className="inline-flex min-h-8 items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                              >
                                {busyAction?.type === "rename" ? "..." : th ? "บันทึก" : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditingName("");
                                  setErrorText("");
                                }}
                                className="inline-flex min-h-8 items-center rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                              >
                                {th ? "ยกเลิก" : "Cancel"}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={(event) => { event.preventDefault(); event.stopPropagation(); startEdit(row.id, row.name); }}
                                className="inline-flex min-h-8 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
                              >
                                {th ? "แก้ไข" : "Edit"}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => { event.preventDefault(); event.stopPropagation(); void deleteCategory(row.id); }}
                                disabled={busy || row.productCount > 0}
                                className="inline-flex min-h-8 items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {busyAction?.type === "delete" ? "..." : th ? "ลบ" : "Delete"}
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

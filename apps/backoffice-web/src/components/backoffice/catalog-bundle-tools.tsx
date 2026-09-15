"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  is_combo: boolean;
  is_active: boolean;
  deleted_at?: string | null;
  delete_reason?: string | null;
  restore_until?: string | null;
};

type EligibleProduct = Pick<CatalogProduct, "id" | "sku" | "name" | "category" | "price" | "is_active" | "is_combo">;
type BundleLine = { product_id: string; qty: number; product: { id: string; sku: string; name: string; price: number } | null };
type BundleProduct = CatalogProduct & { bundle_items: BundleLine[] };

type Envelope<T> = { data?: T; error?: unknown; feature?: string | null };

type BundleData = { items: BundleProduct[]; eligible_items: EligibleProduct[] };
type CatalogData = { view: "active" | "trash"; items: CatalogProduct[] };

function errorText(body: Envelope<unknown>, fallback: string) {
  if (typeof body.error === "string") {
    if (body.error === "feature_not_enabled" && body.feature === "bundle_products") {
      return "Bundle Product ใช้งานได้ในแพ็กเกจ Growth 550 บาท/เดือน กรุณาตรวจสอบแพ็กเกจของร้าน";
    }
    return body.error;
  }
  if (body.error && typeof body.error === "object" && "message" in body.error) {
    return String((body.error as { message?: unknown }).message ?? fallback);
  }
  return fallback;
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || body.error) throw new Error(errorText(body, "ดำเนินการไม่สำเร็จ"));
  return body.data as T;
}

function money(value: number) {
  return Number(value ?? 0).toFixed(2);
}

function dateText(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}

export function CatalogBundleTools() {
  const [active, setActive] = useState<CatalogProduct[]>([]);
  const [trash, setTrash] = useState<CatalogProduct[]>([]);
  const [bundles, setBundles] = useState<BundleProduct[]>([]);
  const [eligible, setEligible] = useState<EligibleProduct[]>([]);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setCatalogError(null);
    const [activeResult, trashResult, bundleResult] = await Promise.allSettled([
      readJson<CatalogData>("/api/backoffice/catalog-lifecycle?view=active"),
      readJson<CatalogData>("/api/backoffice/catalog-lifecycle?view=trash"),
      readJson<BundleData>("/api/backoffice/bundles")
    ]);

    if (activeResult.status === "fulfilled") setActive(activeResult.value.items);
    if (trashResult.status === "fulfilled") setTrash(trashResult.value.items);
    if (activeResult.status === "rejected" || trashResult.status === "rejected") {
      const reason = activeResult.status === "rejected" ? activeResult.reason : trashResult.status === "rejected" ? trashResult.reason : null;
      setCatalogError(reason instanceof Error ? reason.message : "โหลดรายการสินค้าไม่สำเร็จ");
    }

    if (bundleResult.status === "fulfilled") {
      setBundles(bundleResult.value.items);
      setEligible(bundleResult.value.eligible_items);
      setBundleError(null);
    } else {
      setBundleError(bundleResult.reason instanceof Error ? bundleResult.reason.message : "โหลด Bundle Product ไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredActive = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return active.slice(0, 30);
    return active.filter((item) => `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(q)).slice(0, 30);
  }, [active, search]);

  async function lifecycle(action: "soft_delete" | "restore", product: CatalogProduct) {
    if (action === "soft_delete" && !window.confirm(`ย้าย “${product.name}” ไปถังขยะ? ข้อมูลรายการขายเดิมจะไม่ถูกลบ`)) return;
    setBusy(true);
    setNotice(null);
    setCatalogError(null);
    try {
      await readJson("/api/backoffice/catalog-lifecycle", {
        method: "POST",
        body: JSON.stringify({ action, product_id: product.id, reason: action === "soft_delete" ? "backoffice_catalog_soft_delete" : undefined })
      });
      setNotice(action === "restore" ? `กู้คืน ${product.name} แล้ว` : `ย้าย ${product.name} ไปถังขยะแล้ว สามารถกู้คืนได้ภายใน 30 วัน`);
      if (editingId === product.id) {
        setEditingId(null);
        setSelected({});
      }
      await load();
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(bundle: BundleProduct) {
    setEditingId(bundle.id);
    setSelected(Object.fromEntries(bundle.bundle_items.map((item) => [item.product_id, Number(item.qty || 1)])));
    requestAnimationFrame(() => document.getElementById("bundle-product-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function toggleProduct(productId: string) {
    setSelected((current) => {
      const next = { ...current };
      if (productId in next) delete next[productId];
      else next[productId] = 1;
      return next;
    });
  }

  async function submitBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const items = Object.entries(selected).map(([product_id, qty]) => ({ product_id, qty: Number(qty) }));
    if (items.length < 2) {
      setBundleError("กรุณาเลือกสินค้าอย่างน้อย 2 รายการสำหรับ Bundle");
      return;
    }
    setBusy(true);
    setBundleError(null);
    setNotice(null);
    try {
      await readJson("/api/backoffice/bundles", {
        method: "POST",
        body: JSON.stringify({
          action: "upsert_bundle",
          id: editingId,
          sku: String(form.get("sku") ?? ""),
          name: String(form.get("name") ?? ""),
          category: String(form.get("category") ?? "Bundle"),
          price: Number(form.get("price") ?? 0),
          items
        })
      });
      setNotice(editingId ? "อัปเดต Bundle Product แล้ว" : "สร้าง Bundle Product แล้ว และผูกการตัดสต๊อกจากสินค้าภายในชุดแล้ว");
      setEditingId(null);
      setSelected({});
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setBundleError(error instanceof Error ? error.message : "บันทึก Bundle Product ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const editingBundle = editingId ? bundles.find((item) => item.id === editingId) ?? null : null;

  return (
    <section className="space-y-6">
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div> : null}

      <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Growth Package · 550 บาท/เดือน</div>
            <h3 className="mt-1 text-lg font-extrabold text-slate-900">Bundle Product / สินค้าจัดชุด</h3>
            <p className="mt-1 text-sm text-slate-600">รวมสินค้าหลายรายการเป็น 1 สินค้าขาย พร้อมสร้างสูตรตัดสต๊กรวมจากสินค้าภายในชุดโดยอัตโนมัติ</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">รีเฟรช</button>
        </div>

        {bundleError ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{bundleError}</div> : null}

        {!bundleError ? (
          <>
            <form id="bundle-product-form" onSubmit={submitBundle} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-2 md:grid-cols-4">
                <input name="sku" defaultValue={editingBundle?.sku ?? ""} key={`sku-${editingId ?? "new"}`} placeholder="SKU (เว้นว่างให้ระบบสร้าง)" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                <input name="name" defaultValue={editingBundle?.name ?? ""} key={`name-${editingId ?? "new"}`} required placeholder="ชื่อ Bundle" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                <input name="category" defaultValue={editingBundle?.category ?? "Bundle"} key={`category-${editingId ?? "new"}`} required placeholder="หมวดหมู่" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                <input name="price" defaultValue={editingBundle?.price ?? ""} key={`price-${editingId ?? "new"}`} required type="number" min="0" step="0.01" placeholder="ราคาขาย" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {eligible.map((product) => {
                  const checked = product.id in selected;
                  return (
                    <label key={product.id} className={`rounded-xl border p-3 ${checked ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={checked} onChange={() => toggleProduct(product.id)} className="mt-1" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-slate-900">{product.name}</div>
                          <div className="text-xs text-slate-500">{product.sku} · ฿{money(product.price)}</div>
                          {checked ? (
                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                              จำนวน
                              <input type="number" min="0.001" step="0.001" value={selected[product.id]} onChange={(event) => setSelected((current) => ({ ...current, [product.id]: Number(event.target.value) }))} className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1" />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {editingId ? <button type="button" onClick={() => { setEditingId(null); setSelected({}); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">ยกเลิกแก้ไข</button> : null}
                <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{busy ? "กำลังบันทึก..." : editingId ? "อัปเดต Bundle" : "สร้าง Bundle Product"}</button>
              </div>
            </form>

            <div className="mt-4 space-y-2">
              {bundles.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มี Bundle Product ในสาขานี้</p> : bundles.map((bundle) => (
                <div key={bundle.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
                  <div>
                    <div className="font-bold text-slate-900">{bundle.name} <span className="text-sm font-normal text-slate-500">· ฿{money(bundle.price)}</span></div>
                    <div className="mt-1 text-xs text-slate-500">{bundle.bundle_items.map((line) => `${line.product?.name ?? line.product_id} × ${line.qty}`).join(" + ")}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => beginEdit(bundle)} className="rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-700">แก้ไขชุด</button>
                    <button type="button" disabled={busy} onClick={() => void lifecycle("soft_delete", bundle)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700">ย้ายไปถังขยะ</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Catalog Soft-delete & ถังขยะสินค้า</h3>
            <p className="mt-1 text-sm text-slate-600">การลบจะซ่อนสินค้าออกจากการขาย แต่เก็บประวัติและความสัมพันธ์เดิมไว้ กู้คืนได้ภายใน 30 วัน</p>
          </div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาสินค้าที่จะลบ" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
        </div>
        {catalogError ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{catalogError}</div> : null}

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-extrabold text-slate-800">สินค้าใน Catalog</div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {filteredActive.map((product) => (
                <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <div className="min-w-0"><div className="truncate text-sm font-bold text-slate-900">{product.name}</div><div className="text-xs text-slate-500">{product.sku} · {product.category}{product.is_combo ? " · Bundle" : ""}</div></div>
                  <button type="button" disabled={busy} onClick={() => void lifecycle("soft_delete", product)} className="shrink-0 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700">ลบแบบปลอดภัย</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-extrabold text-slate-800">ถังขยะ ({trash.length})</div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {trash.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-500">ถังขยะว่าง</p> : trash.map((product) => (
                <div key={product.id} className="rounded-xl border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><div className="truncate text-sm font-bold text-slate-900">{product.name}</div><div className="text-xs text-slate-500">ลบเมื่อ {dateText(product.deleted_at)} · กู้คืนได้ถึง {dateText(product.restore_until)}</div></div>
                    <button type="button" disabled={busy} onClick={() => void lifecycle("restore", product)} className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">กู้คืน</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

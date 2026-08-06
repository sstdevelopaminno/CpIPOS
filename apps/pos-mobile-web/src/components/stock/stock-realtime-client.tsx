"use client";

import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  PackageOpen,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  TriangleAlert,
  Wheat,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 5;
const ALL_CATEGORY = "ทั้งหมด";

type Product = { id: string; sku: string | null; name: string; category: string; price: number; isActive: boolean; stockDeductionMode: string };
type Ingredient = { id: string; name: string; baseUnit: string; quantityOnHand: number; reorderLevel: number; updatedAt: string | null; status: "ok" | "low" | "out" };
type SaleDeduction = { id: string; ingredientId: string | null; quantityDelta: number; reason: string | null; createdAt: string | null };

export type StockSnapshot = {
  products: Product[];
  categories: string[];
  ingredients: Ingredient[];
  recentSaleDeductions: SaleDeduction[];
  summary: { activeProducts: number; categories: number; trackedIngredients: number; lowIngredients: number; outIngredients: number };
  refreshedAt: string;
};

type ApiResponse = { data?: StockSnapshot; error?: { message?: string } };
type Mode = "products" | "ingredients";
type DetailState = { type: "product"; product: Product } | { type: "ingredient"; ingredient: Ingredient } | null;
type ModalState = { type: "product"; product?: Product } | { type: "ingredient"; ingredient?: Ingredient } | { type: "adjust"; ingredient: Ingredient } | null;

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function cleanStockName(name: string) {
  return name.replace(/^STOCK:PRD-/i, "").replace(/-\d{5,}:/g, " / ").replace(/:/g, " / ");
}

function statusText(status: Ingredient["status"]) {
  if (status === "out") return "หมด";
  if (status === "low") return "ต่ำ";
  return "พร้อม";
}

function statusClass(status: Ingredient["status"]) {
  if (status === "out") return "bg-[#fff1f1] text-[#d62929]";
  if (status === "low") return "bg-[#fff7ed] text-[#c2410c]";
  return "bg-[#e8fff2] text-[#0f8d46]";
}

async function sendStockRequest(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
  const response = await fetch("/api/mobile/stock", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok || json?.error) throw new Error(json?.error?.message ?? "ทำรายการไม่สำเร็จ");
}

function SummaryCard({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
  return (
    <section className="min-w-0 rounded-[16px] border border-[#d4e5f8] bg-white p-3 shadow-[0_8px_20px_rgba(15,39,69,0.06)]">
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="min-w-0 text-[11px] font-black leading-tight text-[#587398]">{label}</span>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[13px] ${tone}`}>
          <Icon size={19} />
        </span>
      </div>
      <b className="block truncate text-[20px] leading-none text-[#031f3d]">{value}</b>
    </section>
  );
}

function EmptyState({ mode }: { mode: Mode }) {
  return (
    <div className="grid min-h-[190px] place-items-center rounded-[14px] bg-[#f8fbff] px-5 py-8 text-center">
      <div>
        <p className="m-0 text-[16px] font-black text-[#0f2745]">ไม่พบรายการ</p>
        <p className="m-0 mt-2 text-[13px] font-bold text-[#7a8fa8]">{mode === "products" ? "ลองเปลี่ยนคำค้นหาหรือหมวดหมู่" : "ลองเปลี่ยนคำค้นหาหรือเพิ่มวัตถุดิบใหม่"}</p>
      </div>
    </div>
  );
}

export function StockRealtimeClient({ initialSnapshot }: { initialSnapshot: StockSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [mode, setMode] = useState<Mode>("products");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<DetailState>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const categories = useMemo(() => {
    const fromProducts = snapshot.products.map((product) => product.category).filter(Boolean);
    return [ALL_CATEGORY, ...Array.from(new Set([...snapshot.categories, ...fromProducts]))];
  }, [snapshot.categories, snapshot.products]);

  const filteredProducts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return snapshot.products.filter((product) => {
      const matchesCategory = selectedCategory === ALL_CATEGORY || product.category === selectedCategory;
      const matchesSearch = !search || [product.name, product.sku ?? "", product.category, money(product.price)].join(" ").toLowerCase().includes(search);
      return matchesCategory && matchesSearch;
    });
  }, [query, selectedCategory, snapshot.products]);

  const filteredIngredients = useMemo(() => {
    const search = query.trim().toLowerCase();
    return snapshot.ingredients.filter((ingredient) => !search || [cleanStockName(ingredient.name), ingredient.baseUnit, qty(ingredient.quantityOnHand), statusText(ingredient.status)].join(" ").toLowerCase().includes(search));
  }, [query, snapshot.ingredients]);

  const activeTotal = mode === "products" ? filteredProducts.length : filteredIngredients.length;
  const pageCount = Math.max(1, Math.ceil(activeTotal / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedProducts = filteredProducts.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const pagedIngredients = filteredIngredients.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const activeProducts = snapshot.products.filter((product) => product.isActive).length;

  const refreshStock = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setRefreshing(true);
      const response = await fetch("/api/mobile/stock", { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || json?.error || !json?.data) {
        setError(json?.error?.message ?? "โหลดสต๊อกล่าสุดไม่สำเร็จ");
        return;
      }
      setSnapshot(json.data);
      setError("");
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshStock(true);
    }, 3000);
    const handleFocus = () => void refreshStock(true);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshStock]);

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setPage(0);
  }

  function chooseCategory(category: string) {
    setSelectedCategory(category);
    setPage(0);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setPage(0);
  }

  async function handleDelete(kind: "product" | "ingredient", id: string) {
    const confirmed = window.confirm(kind === "product" ? "ปิดการขายสินค้านี้?" : "ลบวัตถุดิบนี้?");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await sendStockRequest("DELETE", { kind, id });
      setDetail(null);
      await refreshStock(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid w-full max-w-full min-w-0 gap-4 pb-8 text-[#0f2745]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h1 className="m-0 min-w-0 text-[21px] font-black leading-tight text-[#0f2745]">สินค้า</h1>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setModal({ type: "product" })} className="grid min-h-10 w-10 place-items-center rounded-[13px] bg-[#1677d9] text-white shadow-sm outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2" aria-label="เพิ่มสินค้า">
            <PackagePlus size={19} />
          </button>
          <button type="button" onClick={() => setModal({ type: "ingredient" })} className="grid min-h-10 w-10 place-items-center rounded-[13px] bg-[#16a34a] text-white shadow-sm outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-[#16a34a] focus-visible:ring-offset-2" aria-label="เพิ่มวัตถุดิบ">
            <Wheat size={19} />
          </button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-3">
        <SummaryCard icon={PackageOpen} label="สินค้า active" value={String(activeProducts)} tone="bg-[#e8fff2] text-[#0f8d46]" />
        <SummaryCard icon={ClipboardList} label="หมวดหมู่" value={String(categories.length - 1)} tone="bg-[#f0f6ff] text-[#1677d9]" />
        <SummaryCard icon={Boxes} label="วัตถุดิบทั้งหมด" value={String(snapshot.ingredients.length)} tone="bg-[#f0f6ff] text-[#1677d9]" />
        <SummaryCard icon={TriangleAlert} label="วัตถุดิบใกล้หมด" value={String(snapshot.summary.lowIngredients + snapshot.summary.outIngredients)} tone="bg-[#fff7ed] text-[#c2410c]" />
      </div>

      {error ? <div className="rounded-[14px] border border-[#fecaca] bg-[#fff1f1] p-3 text-[13px] font-black text-[#d62929]" role="alert">{error}</div> : null}

      <section className="min-w-0 overflow-hidden rounded-[20px] border border-[#d4e5f8] bg-white p-3 shadow-[0_8px_20px_rgba(15,39,69,0.06)]">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
          <h2 className="m-0 min-w-0 text-[17px] font-black text-[#0f2745]">{mode === "products" ? "สินค้าตามหมวด" : "สต๊อกวัตถุดิบคงเหลือ"}</h2>
          {mode === "products" ? <ShoppingBag className="h-6 w-6 shrink-0 text-[#1677d9]" /> : <Boxes className="h-6 w-6 shrink-0 text-[#1677d9]" />}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 rounded-[16px] bg-[#eef6ff] p-1">
          <button type="button" onClick={() => selectMode("products")} className={`min-h-10 rounded-[13px] text-[13px] font-black transition active:scale-[0.98] ${mode === "products" ? "bg-[#1677d9] text-white shadow-sm" : "text-[#17416f]"}`}>
            สินค้า
          </button>
          <button type="button" onClick={() => selectMode("ingredients")} className={`min-h-10 rounded-[13px] text-[13px] font-black transition active:scale-[0.98] ${mode === "ingredients" ? "bg-[#1677d9] text-white shadow-sm" : "text-[#17416f]"}`}>
            วัตถุดิบ
          </button>
        </div>

        <label className="mb-3 grid h-11 grid-cols-[auto_1fr] items-center gap-2 rounded-[14px] border border-[#cfe1f5] bg-[#fbfdff] px-3 shadow-inner focus-within:border-[#1677d9] focus-within:ring-2 focus-within:ring-[#b9dcff]">
          <Search size={18} className="text-[#5f7491]" aria-hidden="true" />
          <input value={query} onChange={(event) => updateQuery(event.target.value)} placeholder={mode === "products" ? "ค้นหาสินค้า" : "ค้นหาวัตถุดิบ"} className="min-w-0 bg-transparent text-[14px] font-bold text-[#0f2745] outline-none placeholder:text-[#9aaac0]" aria-label="ค้นหาสินค้าหรือวัตถุดิบ" />
        </label>

        {mode === "products" ? (
          <div className="-mx-1 mb-3 flex max-w-full touch-pan-x gap-2 overflow-x-auto px-1 pb-1" aria-label="เลือกหมวดหมู่สินค้า">
            {categories.map((category) => {
              const active = category === selectedCategory;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => chooseCategory(category)}
                  className={`min-h-10 max-w-[132px] shrink-0 truncate rounded-full border px-4 text-[12px] font-black outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2 ${active ? "border-[#1677d9] bg-[#1677d9] text-white" : "border-[#d9e8f7] bg-[#f8fbff] text-[#17416f]"}`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        ) : null}

        {refreshing ? (
          <div className="grid min-h-[190px] place-items-center rounded-[14px] bg-[#f8fbff] px-4 py-8 text-center text-[14px] font-black text-[#587398]">กำลังโหลดข้อมูล...</div>
        ) : activeTotal === 0 ? (
          <EmptyState mode={mode} />
        ) : mode === "products" ? (
          <div className="grid gap-2">
            {pagedProducts.map((product) => (
              <article key={product.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[14px] bg-[#f8fbff] px-3 py-3">
                <button type="button" onClick={() => setDetail({ type: "product", product })} className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2">
                  <b className="block truncate text-[13px] text-[#0f2745]">{product.name}</b>
                  <span className="block truncate text-[11px] font-bold text-[#587398]">{product.sku ?? "-"} / ฿{money(product.price)}</span>
                  <span className="mt-1 block truncate text-[10px] font-black text-[#7a8fa8]">{product.category}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={`hidden rounded-full px-2 py-1 text-[10px] font-black min-[390px]:inline-flex ${product.isActive ? "bg-[#e8fff2] text-[#0f8d46]" : "bg-[#eef2f7] text-[#64748b]"}`}>{product.isActive ? "พร้อมขาย" : "ปิดขาย"}</span>
                  <button type="button" aria-label={`แก้ไขสินค้า ${product.name}`} onClick={() => setModal({ type: "product", product })} className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#cfe4fb] bg-[#f2f8ff] text-[#1677d9] outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2">
                    <Pencil size={15} />
                  </button>
                  <button type="button" aria-label={`ลบสินค้า ${product.name}`} onClick={() => void handleDelete("product", product.id)} disabled={saving} className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#fecaca] bg-[#fff1f1] text-[#ef4444] outline-none transition active:scale-95 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[#ef4444] focus-visible:ring-offset-2">
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid gap-2">
            {pagedIngredients.map((ingredient) => (
              <article key={ingredient.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[14px] border border-[#e2eefb] bg-[#f8fbff] px-3 py-2.5">
                <button type="button" onClick={() => setDetail({ type: "ingredient", ingredient })} className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2">
                  <b className="block truncate text-[13px] text-[#0f2745]">{cleanStockName(ingredient.name)}</b>
                  <span className="block truncate text-[11px] font-bold text-[#587398]">เตือนที่ {qty(ingredient.reorderLevel)} {ingredient.baseUnit}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="mr-1 text-right">
                    <b className="block text-[14px] text-[#0f2745]">{qty(ingredient.quantityOnHand)} {ingredient.baseUnit}</b>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${statusClass(ingredient.status)}`}>{statusText(ingredient.status)}</span>
                  </span>
                  <button type="button" aria-label={`เพิ่ม/ลดจำนวน ${cleanStockName(ingredient.name)}`} onClick={() => setModal({ type: "adjust", ingredient })} className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#1677d9] text-white outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2">
                    <Plus size={15} />
                  </button>
                  <button type="button" aria-label={`แก้ไขวัตถุดิบ ${cleanStockName(ingredient.name)}`} onClick={() => setModal({ type: "ingredient", ingredient })} className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#cfe4fb] bg-[#f2f8ff] text-[#1677d9] outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2">
                    <Pencil size={15} />
                  </button>
                  <button type="button" aria-label={`ลบวัตถุดิบ ${cleanStockName(ingredient.name)}`} onClick={() => void handleDelete("ingredient", ingredient.id)} disabled={saving} className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#fecaca] bg-[#fff1f1] text-[#ef4444] outline-none transition active:scale-95 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[#ef4444] focus-visible:ring-offset-2">
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-[44px_1fr_44px] items-center gap-2">
          <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0} className="grid min-h-11 w-11 place-items-center rounded-[13px] border border-[#d9e8f7] bg-[#f8fbff] text-[#17416f] disabled:text-[#9aaac0] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2" aria-label="ก่อนหน้า">
            <ChevronLeft size={19} />
          </button>
          <span className="min-w-0 text-center text-[13px] font-black text-[#587398]">หน้า {currentPage + 1} / {pageCount}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage >= pageCount - 1} className="grid min-h-11 w-11 place-items-center rounded-[13px] bg-[#1677d9] text-white disabled:bg-[#dbeafe] disabled:text-[#8aa0bb] focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2" aria-label="ถัดไป">
            <ChevronRight size={19} />
          </button>
        </div>
      </section>

      <p className="sr-only" aria-live="polite">{refreshing ? "กำลังโหลดข้อมูล" : `แสดง ${activeTotal} รายการ`}</p>

      {detail ? (
        <StockDetailModal
          detail={detail}
          saving={saving}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setModal(detail.type === "product" ? { type: "product", product: detail.product } : { type: "ingredient", ingredient: detail.ingredient });
            setDetail(null);
          }}
          onAdjust={detail.type === "ingredient" ? () => {
            setModal({ type: "adjust", ingredient: detail.ingredient });
            setDetail(null);
          } : undefined}
          onDelete={() => void handleDelete(detail.type, detail.type === "product" ? detail.product.id : detail.ingredient.id)}
        />
      ) : null}

      {modal ? (
        <StockModal
          modal={modal}
          categories={snapshot.categories}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={async (method, payload) => {
            setSaving(true);
            setError("");
            try {
              await sendStockRequest(method, payload);
              setModal(null);
              await refreshStock(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function StockDetailModal({ detail, saving, onClose, onEdit, onAdjust, onDelete }: {
  detail: Exclude<DetailState, null>;
  saving: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAdjust?: () => void;
  onDelete: () => void;
}) {
  const isProduct = detail.type === "product";
  const product = isProduct ? detail.product : null;
  const ingredient = !isProduct ? detail.ingredient : null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[220] grid place-items-center bg-[rgba(15,39,69,0.42)] p-4">
      <section className="w-full max-w-[390px] rounded-[22px] bg-white p-4 shadow-[0_24px_70px_rgba(15,39,69,0.28)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-[19px] font-black text-[#0f2745]">{product ? product.name : cleanStockName(ingredient?.name ?? "-")}</h2>
            <p className="m-0 mt-1 text-[12px] font-bold text-[#587398]">{isProduct ? "รายละเอียดสินค้า" : "รายละเอียดวัตถุดิบ"}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-[#d9e8f7] bg-white text-[#17416f] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2" aria-label="ปิด">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 grid gap-2 rounded-[16px] bg-[#f8fbff] p-3 text-[13px] font-bold text-[#587398]">
          {product ? (
            <>
              <p className="m-0 flex justify-between gap-3"><span>รหัส</span><b className="min-w-0 truncate text-[#0f2745]">{product.sku ?? "-"}</b></p>
              <p className="m-0 flex justify-between gap-3"><span>หมวด</span><b className="min-w-0 truncate text-[#0f2745]">{product.category}</b></p>
              <p className="m-0 flex justify-between gap-3"><span>ราคา</span><b className="text-[#1677d9]">฿{money(product.price)}</b></p>
              <p className="m-0 flex justify-between gap-3"><span>สถานะ</span><b className={product.isActive ? "text-[#0f8d46]" : "text-[#64748b]"}>{product.isActive ? "พร้อมขาย" : "ปิดขาย"}</b></p>
            </>
          ) : ingredient ? (
            <>
              <p className="m-0 flex justify-between gap-3"><span>คงเหลือ</span><b className="text-[#0f2745]">{qty(ingredient.quantityOnHand)} {ingredient.baseUnit}</b></p>
              <p className="m-0 flex justify-between gap-3"><span>จุดเตือน</span><b className="text-[#0f2745]">{qty(ingredient.reorderLevel)} {ingredient.baseUnit}</b></p>
              <p className="m-0 flex justify-between gap-3"><span>สถานะ</span><b className={ingredient.status === "ok" ? "text-[#0f8d46]" : "text-[#c2410c]"}>{statusText(ingredient.status)}</b></p>
            </>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {onAdjust ? <button type="button" onClick={onAdjust} className="min-h-11 rounded-[14px] bg-[#1677d9] px-3 text-[13px] font-black text-white">เพิ่ม/ลด</button> : null}
          <button type="button" onClick={onEdit} className="min-h-11 rounded-[14px] border border-[#cfe4fb] bg-[#f2f8ff] px-3 text-[13px] font-black text-[#1677d9]">แก้ไข</button>
          <button type="button" onClick={onDelete} disabled={saving} className={`${onAdjust ? "col-span-2" : ""} min-h-11 rounded-[14px] border border-[#fecaca] bg-[#fff1f1] px-3 text-[13px] font-black text-[#ef4444] disabled:opacity-60`}>ลบ</button>
        </div>
      </section>
    </div>
  );
}

function StockModal({ modal, categories, saving, onClose, onSave }: {
  modal: Exclude<ModalState, null>;
  categories: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (method: "POST" | "PATCH", payload: Record<string, unknown>) => Promise<void>;
}) {
  const isProduct = modal.type === "product";
  const isIngredient = modal.type === "ingredient";
  const product = isProduct ? modal.product : undefined;
  const ingredient = isIngredient ? modal.ingredient : modal.type === "adjust" ? modal.ingredient : undefined;
  const categoryOptions = useMemo(() => {
    const fallback = categories.length ? categories : ["ทั่วไป"];
    return Array.from(new Set([product?.category, ...fallback].filter((value): value is string => Boolean(value))));
  }, [categories, product?.category]);
  const [name, setName] = useState(product?.name ?? (ingredient ? cleanStockName(ingredient.name) : ""));
  const [category, setCategory] = useState(product?.category ?? categoryOptions[0] ?? "ทั่วไป");
  const [price, setPrice] = useState(product ? String(product.price) : "0");
  const [baseUnit, setBaseUnit] = useState(ingredient?.baseUnit || "piece");
  const [quantity, setQuantity] = useState(ingredient ? String(ingredient.quantityOnHand) : "0");
  const [reorder, setReorder] = useState(ingredient ? String(ingredient.reorderLevel) : "0");
  const [delta, setDelta] = useState("");

  async function submit() {
    if (modal.type === "adjust") {
      await onSave("PATCH", { action: "restock", ingredientId: modal.ingredient.id, quantityDelta: Number(delta || 0), reason: "Mobile stock quantity update" });
      return;
    }
    if (modal.type === "product") {
      await onSave(product ? "PATCH" : "POST", { kind: "product", id: product?.id, name, category, price: Number(price || 0), isActive: product?.isActive ?? true });
      return;
    }
    await onSave(ingredient ? "PATCH" : "POST", { kind: "ingredient", id: ingredient?.id, name, baseUnit, quantityOnHand: Number(quantity || 0), reorderLevel: Number(reorder || 0) });
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[230] grid place-items-center bg-[rgba(15,39,69,0.42)] p-4">
      <section className="w-full max-w-[440px] rounded-[24px] bg-white p-4 shadow-[0_24px_70px_rgba(15,39,69,0.28)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[20px] font-black text-[#0f2745]">{modal.type === "adjust" ? "เพิ่ม/ลดจำนวน" : isProduct ? product ? "แก้ไขสินค้า" : "เพิ่มสินค้า" : ingredient ? "แก้ไขวัตถุดิบ" : "เพิ่มวัตถุดิบ"}</h2>
          <button type="button" onClick={onClose} className="h-10 rounded-[12px] border border-[#d9e8f7] bg-white px-4 text-[13px] font-black text-[#17416f] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2">ปิด</button>
        </div>
        <div className="mt-4 grid gap-3">
          {modal.type === "adjust" ? (
            <>
              <p className="m-0 rounded-[14px] bg-[#f8fbff] p-3 text-[14px] font-black text-[#0f2745]">{cleanStockName(modal.ingredient.name)} คงเหลือ {qty(modal.ingredient.quantityOnHand)} {modal.ingredient.baseUnit}</p>
              <label className="grid gap-1 text-[12px] font-black text-[#587398]">
                จำนวนที่ปรับ
                <input value={delta} onChange={(event) => setDelta(event.target.value)} type="number" step="0.001" placeholder="เพิ่ม เช่น 10 / ลด เช่น -2" className="h-12 rounded-[14px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[15px] font-bold text-[#0f2745] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9]" />
              </label>
            </>
          ) : (
            <>
              <label className="grid gap-1 text-[12px] font-black text-[#587398]">
                {isProduct ? "ชื่อสินค้า" : "ชื่อวัตถุดิบ"}
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder={isProduct ? "เช่น ก๋วยเตี๋ยวไก่ตุ๋น" : "เช่น เส้นก๋วยเตี๋ยว"} className="h-12 rounded-[14px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[15px] font-bold text-[#0f2745] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9]" />
              </label>
              {isProduct ? (
                <>
                  <label className="grid gap-1 text-[12px] font-black text-[#587398]">
                    หมวดหมู่
                    <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-12 rounded-[14px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[15px] font-bold text-[#0f2745] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9]">
                      {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <p className="m-0 rounded-[12px] bg-[#eef6ff] px-3 py-2 text-[12px] font-bold text-[#587398]">รหัสสินค้าจะสร้างให้อัตโนมัติเมื่อบันทึก</p>
                  <label className="grid gap-1 text-[12px] font-black text-[#587398]">
                    ราคา
                    <input value={price} onChange={(event) => setPrice(event.target.value)} type="number" placeholder="0.00" className="h-12 rounded-[14px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[15px] font-bold text-[#0f2745] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9]" />
                  </label>
                </>
              ) : (
                <>
                  <label className="grid gap-1 text-[12px] font-black text-[#587398]">
                    หน่วย
                    <input value={baseUnit} onChange={(event) => setBaseUnit(event.target.value)} placeholder="เช่น gram, piece" className="h-12 rounded-[14px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[15px] font-bold text-[#0f2745] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9]" />
                  </label>
                  <label className="grid gap-1 text-[12px] font-black text-[#587398]">
                    จำนวนคงเหลือ
                    <input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" placeholder="0" className="h-12 rounded-[14px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[15px] font-bold text-[#0f2745] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9]" />
                  </label>
                  <label className="grid gap-1 text-[12px] font-black text-[#587398]">
                    จุดเตือน
                    <input value={reorder} onChange={(event) => setReorder(event.target.value)} type="number" placeholder="0" className="h-12 rounded-[14px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[15px] font-bold text-[#0f2745] outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9]" />
                  </label>
                </>
              )}
            </>
          )}
        </div>
        <button type="button" onClick={() => void submit()} disabled={saving} className="mt-4 h-12 w-full rounded-[15px] bg-[#1677d9] text-[15px] font-black text-white outline-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2">
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </section>
    </div>
  );
}

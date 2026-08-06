"use client";

import {
  ArrowLeft,
  Boxes,
  ChartNoAxesColumnIncreasing,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  PackageCheck,
  PackageOpen,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

const PAGE_SIZE = 5;
const ALL_CATEGORY = "ทั้งหมด";

type Product = {
  id: string;
  sku: string | null;
  name: string;
  category: string;
  price: number;
};

type Ingredient = {
  id: string;
  name: string | null;
  baseUnit: string | null;
  quantityOnHand: number;
  reorderLevel: number;
};

type Props = {
  stats: {
    todayTotal: string;
    activeOrderCount: string;
    activeProductCount: string;
    lowIngredientCount: string;
  };
  products: Product[];
  ingredients: Ingredient[];
};

function money(value: number) {
  return Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function cleanStockName(name: string | null | undefined) {
  return String(name ?? "-").replace(/^STOCK:PRD-/i, "").replace(/-\d{5,}:/g, " / ").replace(/:/g, " / ");
}

function ingredientStatus(row: Ingredient) {
  if (row.quantityOnHand <= 0) return { label: "หมด", className: "bg-[#fff1f1] text-[#d62929]" };
  if (row.reorderLevel > 0 && row.quantityOnHand <= row.reorderLevel) return { label: "ใกล้หมด", className: "bg-[#fff7ed] text-[#c2410c]" };
  return { label: "พร้อม", className: "bg-[#e8fff2] text-[#0f8d46]" };
}

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
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

export function StockReadinessClient({ stats, products, ingredients }: Props) {
  const categories = useMemo(() => [ALL_CATEGORY, ...Array.from(new Set(products.map((product) => product.category || "อื่นๆ")))], [products]);
  const [mode, setMode] = useState<"products" | "ingredients">("products");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY);
  const [page, setPage] = useState(0);
  const filteredProducts = selectedCategory === ALL_CATEGORY ? products : products.filter((product) => product.category === selectedCategory);
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleProducts = filteredProducts.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const visibleIngredients = ingredients.slice(0, 8);

  function chooseCategory(category: string) {
    setSelectedCategory(category);
    setPage(0);
  }

  return (
    <section className="grid w-full max-w-full min-w-0 gap-4 pb-8">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h1 className="m-0 min-w-0 text-[21px] font-black leading-tight text-[#0f2745]">สินค้าพร้อมขาย</h1>
        <Link href="/sales" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-[14px] border border-[#d4e5f8] bg-white px-3 text-[13px] font-black text-[#17416f] no-underline shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2" aria-label="กลับหน้าขาย">
          <ArrowLeft size={17} />
          กลับ
        </Link>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-3">
        <Stat icon={ChartNoAxesColumnIncreasing} label="ยอดขายวันนี้" value={stats.todayTotal} tone="bg-[#f0f6ff] text-[#1677d9]" />
        <Stat icon={ClipboardList} label="ออเดอร์ในกะ" value={stats.activeOrderCount} tone="bg-[#f0f6ff] text-[#1677d9]" />
        <Stat icon={PackageCheck} label="สินค้า active" value={stats.activeProductCount} tone="bg-[#e8fff2] text-[#0f8d46]" />
        <Stat icon={TriangleAlert} label="วัตถุดิบใกล้หมด" value={stats.lowIngredientCount} tone="bg-[#fff7ed] text-[#c2410c]" />
      </div>

      <section className="min-w-0 overflow-hidden rounded-[20px] border border-[#d4e5f8] bg-white p-3 shadow-[0_8px_20px_rgba(15,39,69,0.06)]">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
          <h2 className="m-0 min-w-0 text-[17px] font-black text-[#0f2745]">{mode === "products" ? "สินค้าตามหมวด" : "สต๊อกวัตถุดิบคงเหลือ"}</h2>
          {mode === "products" ? <PackageOpen className="h-6 w-6 shrink-0 text-[#1677d9]" /> : <Boxes className="h-6 w-6 shrink-0 text-[#1677d9]" />}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 rounded-[16px] bg-[#eef6ff] p-1">
          <button type="button" onClick={() => setMode("products")} className={`min-h-10 rounded-[13px] text-[13px] font-black transition active:scale-[0.98] ${mode === "products" ? "bg-[#1677d9] text-white shadow-sm" : "text-[#17416f]"}`}>
            สินค้า
          </button>
          <button type="button" onClick={() => setMode("ingredients")} className={`min-h-10 rounded-[13px] text-[13px] font-black transition active:scale-[0.98] ${mode === "ingredients" ? "bg-[#1677d9] text-white shadow-sm" : "text-[#17416f]"}`}>
            วัตถุดิบ
          </button>
        </div>

        {mode === "products" ? (
          <>
            <div className="-mx-1 mb-3 flex max-w-full gap-2 overflow-x-auto px-1 pb-1">
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
            <div className="grid gap-2">
              {visibleProducts.map((product) => (
                <article key={product.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[14px] bg-[#f8fbff] px-3 py-3">
                  <span className="min-w-0">
                    <b className="block truncate text-[13px] text-[#0f2745]">{product.name}</b>
                    <span className="block truncate text-[11px] font-bold text-[#587398]">{product.sku ?? "-"} / ฿{money(product.price)}</span>
                  </span>
                  <span className="self-center rounded-full bg-[#e8fff2] px-2 py-1 text-[10px] font-black text-[#0f8d46]">พร้อมขาย</span>
                </article>
              ))}
              {filteredProducts.length === 0 ? <p className="m-0 rounded-[14px] bg-[#f8fbff] p-3 text-center text-[13px] font-bold text-[#587398]">ยังไม่มีสินค้าในหมวดนี้</p> : null}
            </div>
            <div className="mt-3 grid grid-cols-[44px_1fr_44px] items-center gap-2">
              <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0} className="grid min-h-11 w-11 place-items-center rounded-[13px] border border-[#d9e8f7] bg-[#f8fbff] text-[#17416f] disabled:text-[#9aaac0] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2" aria-label="ก่อนหน้า">
                <ChevronLeft size={19} />
              </button>
              <span className="min-w-0 text-center text-[13px] font-black text-[#587398]">หน้า {currentPage + 1} / {pageCount}</span>
              <button type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage >= pageCount - 1} className="grid min-h-11 w-11 place-items-center rounded-[13px] bg-[#1677d9] text-white disabled:bg-[#dbeafe] disabled:text-[#8aa0bb] focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2" aria-label="ถัดไป">
                <ChevronRight size={19} />
              </button>
            </div>
          </>
        ) : (
          <div className="grid gap-2">
            {visibleIngredients.map((ingredient) => {
              const status = ingredientStatus(ingredient);
              return (
                <article key={ingredient.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[14px] border border-[#e2eefb] bg-[#f8fbff] px-3 py-2.5">
                  <span className="min-w-0">
                    <b className="block truncate text-[13px] text-[#0f2745]">{cleanStockName(ingredient.name)}</b>
                    <span className="block truncate text-[11px] font-bold text-[#587398]">เตือนที่ {qty(ingredient.reorderLevel)} {ingredient.baseUnit ?? ""}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <b className="block text-[14px] text-[#0f2745]">{qty(ingredient.quantityOnHand)} {ingredient.baseUnit ?? ""}</b>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${status.className}`}>{status.label}</span>
                  </span>
                </article>
              );
            })}
            {ingredients.length === 0 ? <p className="m-0 rounded-[14px] bg-[#f8fbff] p-3 text-center text-[13px] font-bold text-[#587398]">ยังไม่มีรายการวัตถุดิบ</p> : null}
          </div>
        )}
      </section>
    </section>
  );
}

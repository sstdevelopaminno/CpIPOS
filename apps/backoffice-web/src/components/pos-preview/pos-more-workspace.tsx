"use client";

import Link from "next/link";
import { type MouseEvent, useEffect, useState } from "react";
import { PackageLockDialog } from "@/components/pos-preview/package-lock-dialog";
import { ItMenuLockDialog } from "@/components/pos-preview/it-menu-lock-dialog";
import { t, type Language } from "@/lib/i18n";
import { featureForPosRoute } from "@/lib/pos-feature-map";
import { isPosMenuEnabled, posMenuKeyForRoute } from "@/lib/pos-menu-policy";

type MoreIconName = "ai" | "summary" | "receipt" | "tables" | "stock" | "members" | "kitchen" | "buffet" | "tax" | "sales";
type PosRole = "owner" | "manager" | "staff" | "accountant";
type MoreItem = {
  href: string;
  icon: MoreIconName;
  labelKey?: "pos_menu_sales_summary" | "pos_menu_receipts" | "pos_menu_tables" | "pos_menu_stock" | "pos_menu_members";
  label?: Record<Language, string>;
  roles: PosRole[];
  desc: Record<Language, string>;
  featured?: boolean;
};

const MORE_ITEMS: MoreItem[] = [
  { href: "/preview/pos/ai-assistant", icon: "ai", label: { th: "CpiPOS AI ผู้ช่วยร้านค้า", en: "CpiPOS AI Store Assistant" }, roles: ["owner", "manager"], desc: { th: "ถามยอดขาย วิเคราะห์ต้นทุนและสต๊อก พร้อมช่วยคิดการตลาดจากข้อมูลจริงของร้าน", en: "Ask about sales, costs, stock, and marketing using your store data" }, featured: true },
  { href: "/preview/pos/sales-summary", icon: "summary", labelKey: "pos_menu_sales_summary", roles: ["owner", "manager", "accountant"], desc: { th: "ดูยอดขาย ภาษี เงินสด/โอน และรายงานประจำกะ", en: "Review sales, tax, cash/transfer, and shift reports" } },
  { href: "/preview/pos/receipts", icon: "receipt", labelKey: "pos_menu_receipts", roles: ["owner", "manager", "accountant"], desc: { th: "ค้นหาใบเสร็จและสั่งพิมพ์ย้อนหลัง 58mm", en: "Search receipts and reprint 58mm receipts" } },
  { href: "/preview/pos/tables", icon: "tables", labelKey: "pos_menu_tables", roles: ["owner", "manager"], desc: { th: "จัดการโต๊ะ โซน และผังร้านสำหรับโหมดนั่งโต๊ะ", en: "Manage dine-in tables, zones, and floor layout" } },
  { href: "/preview/pos/kitchen/manage", icon: "kitchen", label: { th: "จัดการครัว", en: "Kitchen Management" }, roles: ["owner", "manager"], desc: { th: "ตั้งค่าโซนครัว เส้นทางหมวดหมู่อาหาร และจอ KDS", en: "Set kitchen zones, category routing, and KDS screens" } },
  { href: "/preview/pos/stock", icon: "stock", labelKey: "pos_menu_stock", roles: ["owner", "manager"], desc: { th: "สินค้า สต็อก วัตถุดิบ ราคา และหมวดหมู่", en: "Products, stock, ingredients, prices, and categories" } },
  { href: "/preview/pos/buffet-pricing", icon: "buffet", label: { th: "ตั้งค่าราคาบุฟเฟ่", en: "Buffet Price Settings" }, roles: ["owner", "manager"], desc: { th: "กำหนดราคาบุฟเฟ่รายท่านและแบบชุดสำหรับหน้าขาย", en: "Set per-person and set prices for Buffet sales" } },
  { href: "/preview/pos/members", icon: "members", labelKey: "pos_menu_members", roles: ["owner", "manager", "accountant"], desc: { th: "ค้นหาและจัดการข้อมูลสมาชิกหน้าร้าน", en: "Search and manage store member records" } },
  { href: "/preview/pos/tax-invoices", icon: "tax", label: { th: "ออกใบกำกับภาษี", en: "Tax Invoices" }, roles: ["owner", "manager", "staff", "accountant"], desc: { th: "ทะเบียนผู้เสียภาษี ค้นบิลย้อนหลัง และพิมพ์ใบกำกับภาษี 58/80mm", en: "Tax recipient registry, receipt search, and 58/80mm printing" } },
  { href: "/preview/pos/product-sales", icon: "sales", label: { th: "รายการขายสินค้า", en: "Product Sales" }, roles: ["owner", "manager", "accountant"], desc: { th: "ดูสินค้าที่ขาย วันที่ ราคา จำนวน และสถานะสินค้าขายดี", en: "Review sold products, dates, prices, quantities, and best-seller status" } }
];

function MoreIcon({ name }: { name: MoreIconName }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "ai") return <svg {...common}><path d="M12 3l1.2 3.1L16 7.3l-2.8 1.2L12 12l-1.2-3.5L8 7.3l2.8-1.2L12 3Z"/><path d="M5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z"/><path d="M18 12l.9 2.4L21 15.3l-2.1.9L18 19l-.9-2.8-2.1-.9 2.1-.9L18 12Z"/></svg>;
  if (name === "summary") return <svg {...common}><path d="M4 19h16"/><path d="M7 16V9"/><path d="M12 16V5"/><path d="M17 16v-4"/></svg>;
  if (name === "receipt") return <svg {...common}><path d="M7 3h10v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2V3z"/><path d="M9 8h6M9 12h6"/></svg>;
  if (name === "tables") return <svg {...common}><path d="M4 7h16v4H4zM7 11v7M17 11v7M5 18h14"/></svg>;
  if (name === "kitchen") return <svg {...common}><path d="M4 19h16M6 19v-2a6 6 0 0 1 12 0v2M12 7V4M9 5.5 8 3m7 2.5L16 3M5 10h14"/></svg>;
  if (name === "stock") return <svg {...common}><path d="M5 7h14v12H5zM8 7V5h8v2M8 12h8M8 16h5"/></svg>;
  if (name === "buffet") return <svg {...common}><path d="M4 15h16M6 15a6 6 0 0 1 12 0M12 8V5M10.5 5h3M5 19h14"/></svg>;
  if (name === "tax") return <svg {...common}><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/><path d="M10 19h4"/></svg>;
  if (name === "sales") return <svg {...common}><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h8"/><path d="m15 12 1.5 1.5L19 11"/></svg>;
  return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5"/><circle cx="17" cy="10" r="2.2"/><path d="M14.5 17.5c.7-1.4 1.9-2.2 3.5-2.2 1.3 0 2.4.5 3.1 1.5"/></svg>;
}

export function PosMoreWorkspace({ lang, role }: { lang: Language; role: PosRole }) {
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
  const [menuPolicy, setMenuPolicy] = useState<Record<string, boolean>>({});
  const [packageLockOpen, setPackageLockOpen] = useState(false);
  const [itLockedMenu, setItLockedMenu] = useState<string | null>(null);
  const items = MORE_ITEMS.filter((item) => item.roles.includes(role));

  useEffect(() => {
    let cancelled = false;
    async function loadFeatures() {
      try {
        const response = await fetch("/api/pos/features", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { data?: { features?: Record<string, boolean>; menu_policy?: Record<string, boolean> } | null } | null;
        if (!cancelled && response.ok) {
          setEnabledFeatures(body?.data?.features ?? {});
          setMenuPolicy(body?.data?.menu_policy ?? {});
        }
      } catch {
        if (!cancelled) setEnabledFeatures({});
      }
    }
    // IT edits the shared Supabase table from another app. Refresh only when POS
    // regains focus; no per-second polling or long-lived Vercel connections.
    let lastRefresh = Date.now();
    function onFocus() {
      if (Date.now() - lastRefresh < 5_000) return;
      lastRefresh = Date.now();
      void loadFeatures();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") onFocus();
    }
    void loadFeatures();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function isMenuLocked(href: string) {
    return !isPosMenuEnabled(posMenuKeyForRoute(href) ?? "", menuPolicy);
  }

  function isLocked(href: string) {
    const feature = featureForPosRoute(href);
    return Boolean(enabledFeatures !== null && feature && enabledFeatures[feature] === false);
  }

  function handleLocked(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    setPackageLockOpen(true);
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-5">
      <section className="min-h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="mb-5"><h1 className="text-2xl font-black text-slate-950">{t(lang, "pos_menu_more_title")}</h1><p className="mt-1 text-sm font-semibold text-slate-500">{t(lang, "pos_menu_more_desc")}</p></header>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const menuLocked = isMenuLocked(item.href);
            const locked = menuLocked || isLocked(item.href);
            const label = item.label ? item.label[lang] : t(lang, item.labelKey!);
            return (
              <Link key={item.href} href={item.href} prefetch={false} onClick={(event) => { if (menuLocked) { event.preventDefault(); setItLockedMenu(label); } else if (locked) handleLocked(event); }} aria-disabled={locked} className={`group grid grid-cols-[42px_1fr_24px] items-center gap-3 rounded-2xl border p-4 text-left transition ${item.featured ? "min-h-[118px] lg:col-span-2 xl:col-span-3" : "min-h-[92px]"} ${locked ? "border-slate-200 bg-slate-50 text-slate-500" : item.featured ? "border-blue-200 bg-[radial-gradient(circle_at_85%_15%,rgba(56,189,248,0.22),transparent_28%),linear-gradient(135deg,#eff6ff,#ffffff_55%,#ecfeff)] shadow-[0_12px_32px_rgba(37,99,235,0.10)] hover:border-blue-300 hover:shadow-[0_16px_38px_rgba(37,99,235,0.16)]" : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50"}`}>
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${locked ? "bg-slate-100 text-slate-400" : item.featured ? "bg-gradient-to-br from-blue-600 to-cyan-400 text-white shadow-lg shadow-blue-500/20" : "bg-slate-100 text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700"}`}><MoreIcon name={item.icon}/></span>
                <span className="min-w-0"><span className="flex items-center gap-2"><span className={`block font-black text-slate-950 ${item.featured ? "text-lg" : "text-base"}`}>{item.label ? item.label[lang] : t(lang, item.labelKey!)}</span>{item.featured ? <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black tracking-wide text-white">AI</span> : null}</span><span className={`mt-1 block font-medium leading-5 text-slate-500 ${item.featured ? "text-sm sm:text-[15px]" : "text-sm"}`}>{item.desc[lang]}</span></span>
                <span className="text-slate-400">{locked ? <span aria-hidden>🔒</span> : "›"}</span>
              </Link>
            );
          })}
        </div>
      </section>
      <PackageLockDialog lang={lang} open={packageLockOpen} onClose={() => setPackageLockOpen(false)}/>
      <ItMenuLockDialog lang={lang} open={itLockedMenu !== null} menuLabel={itLockedMenu ?? undefined} onClose={() => setItLockedMenu(null)} />
    </main>
  );
}

"use client";

import Link from "next/link";
import { type MouseEvent, useEffect, useState } from "react";
import { PackageLockDialog } from "@/components/pos-preview/package-lock-dialog";
import { ItMenuLockDialog } from "@/components/pos-preview/it-menu-lock-dialog";
import { t, type Language } from "@/lib/i18n";
import { featureForPosRoute } from "@/lib/pos-feature-map";
import { isCustomPosMenuVisible, isPosMenuEnabled, posMenuKeyForRoute } from "@/lib/pos-menu-policy";

type MoreIconName = "summary" | "receipt" | "tables" | "stock" | "members" | "kitchen" | "buffet" | "tax" | "sales" | "documents";
type PosRole = "owner" | "manager" | "staff" | "accountant";
type MoreItem = {
  href: string;
  icon: MoreIconName;
  labelKey?: "pos_menu_sales_summary" | "pos_menu_receipts" | "pos_menu_tables" | "pos_menu_stock" | "pos_menu_members";
  label?: Record<Exclude<Language, "lo">, string>;
  roles: PosRole[];
  desc: Record<Exclude<Language, "lo">, string>;
};

const MORE_ITEMS: MoreItem[] = [
  { href: "/preview/pos/sales-summary", icon: "summary", labelKey: "pos_menu_sales_summary", roles: ["owner", "manager", "accountant"], desc: { th: "ดูยอดขาย ภาษี เงินสด/โอน และรายงานประจำกะ", en: "Review sales, tax, cash/transfer, and shift reports" } },
  { href: "/preview/pos/receipts", icon: "receipt", labelKey: "pos_menu_receipts", roles: ["owner", "manager", "accountant"], desc: { th: "ค้นหาใบเสร็จและสั่งพิมพ์ย้อนหลัง 58mm", en: "Search receipts and reprint 58mm receipts" } },
  { href: "/preview/pos/tables", icon: "tables", labelKey: "pos_menu_tables", roles: ["owner", "manager"], desc: { th: "จัดการโต๊ะ โซน และผังร้านสำหรับโหมดนั่งโต๊ะ", en: "Manage dine-in tables, zones, and floor layout" } },
  { href: "/preview/pos/kitchen/manage", icon: "kitchen", label: { th: "จัดการครัว", en: "Kitchen Management" }, roles: ["owner", "manager"], desc: { th: "ตั้งค่าโซนครัว เส้นทางหมวดหมู่อาหาร และจอ KDS", en: "Set kitchen zones, category routing, and KDS screens" } },
  { href: "/preview/pos/stock", icon: "stock", labelKey: "pos_menu_stock", roles: ["owner", "manager"], desc: { th: "สินค้า สต็อก วัตถุดิบ ราคา และหมวดหมู่", en: "Products, stock, ingredients, prices, and categories" } },
  { href: "/preview/pos/buffet-pricing", icon: "buffet", label: { th: "ตั้งค่าราคาบุฟเฟ่", en: "Buffet Price Settings" }, roles: ["owner", "manager"], desc: { th: "กำหนดราคาบุฟเฟ่รายท่านและแบบชุดสำหรับหน้าขาย", en: "Set per-person and set prices for Buffet sales" } },
  { href: "/preview/pos/members", icon: "members", labelKey: "pos_menu_members", roles: ["owner", "manager", "accountant"], desc: { th: "ค้นหาและจัดการข้อมูลสมาชิกหน้าร้าน", en: "Search and manage store member records" } },
  { href: "/preview/pos/tax-invoices", icon: "tax", label: { th: "ออกใบกำกับภาษี", en: "Tax Invoices" }, roles: ["owner", "manager", "staff", "accountant"], desc: { th: "ทะเบียนผู้เสียภาษี ค้นบิลย้อนหลัง และพิมพ์ใบกำกับภาษี 58/80mm", en: "Tax recipient registry, receipt search, and 58/80mm printing" } },
  { href: "/preview/pos/product-sales", icon: "sales", label: { th: "รายการขายสินค้า", en: "Product Sales" }, roles: ["owner", "manager", "accountant"], desc: { th: "ดูสินค้าที่ขาย วันที่ ราคา จำนวน และสถานะสินค้าขายดี", en: "Review sold products, dates, prices, quantities, and best-seller status" } },
  { href: "/preview/pos/ai-documents", icon: "documents", label: { th: "เก็บไฟล์เอกสาร", en: "AI Documents" }, roles: ["owner", "manager"], desc: { th: "เก็บรายงาน สรุปยอด ตาราง และแผนงานที่สร้างจาก CpiPOS AI", en: "Store reports, summaries, tables and plans created by CpiPOS AI" } }
];

const moreLao:Record<string,{label:string;desc:string}>={
 "/preview/pos/sales-summary":{label:"ສະຫຼຸບຍອດຂາຍ",desc:"ເບິ່ງຍອດຂາຍ ພາສີ ເງິນສົດ/ໂອນ ແລະລາຍງານກະ"},
 "/preview/pos/receipts":{label:"ໃບຮັບເງິນຍ້ອນຫຼັງ",desc:"ຄົ້ນຫາ ແລະພິມໃບຮັບເງິນຊ້ຳ 58mm"},
 "/preview/pos/tables":{label:"ຈັດການໂຕະ",desc:"ຈັດການໂຕະ ໂຊນ ແລະຜັງຮ້ານ"},
 "/preview/pos/kitchen/manage":{label:"ຈັດການເຮືອນຄົວ",desc:"ຕັ້ງຄ່າໂຊນເຮືອນຄົວ ແລະຈໍ KDS"},
 "/preview/pos/stock":{label:"ຈັດການສິນຄ້າ",desc:"ສິນຄ້າ ສະຕັອກ ລາຄາ ແລະໝວດໝູ່"},
 "/preview/pos/buffet-pricing":{label:"ລາຄາບຸບເຟ່",desc:"ກຳນົດລາຄາບຸບເຟ່ຕໍ່ຄົນ ແລະແບບຊຸດ"},
 "/preview/pos/members":{label:"ສະມາຊິກ",desc:"ຄົ້ນຫາ ແລະຈັດການສະມາຊິກ"},
 "/preview/pos/tax-invoices":{label:"ອອກໃບກຳກັບພາສີ",desc:"ຄົ້ນຫາບິນເກົ່າ ແລະພິມໃບພາສີ 58/80mm"},
 "/preview/pos/product-sales":{label:"ລາຍການຂາຍສິນຄ້າ",desc:"ສິນຄ້າທີ່ຂາຍ ວັນທີ ລາຄາ ຈຳນວນ ແລະສະຖານະ"},
 "/preview/pos/ai-documents":{label:"ເກັບໄຟລ໌ເອກະສານ",desc:"ເກັບລາຍງານ ສະຫຼຸບຍອດ ແລະແຜນງານຈາກ CpiPOS AI"}
};

function MoreIcon({ name }: { name: MoreIconName }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "summary") return <svg {...common}><path d="M4 19h16"/><path d="M7 16V9"/><path d="M12 16V5"/><path d="M17 16v-4"/></svg>;
  if (name === "receipt") return <svg {...common}><path d="M7 3h10v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2V3z"/><path d="M9 8h6M9 12h6"/></svg>;
  if (name === "tables") return <svg {...common}><path d="M4 7h16v4H4zM7 11v7M17 11v7M5 18h14"/></svg>;
  if (name === "kitchen") return <svg {...common}><path d="M4 19h16M6 19v-2a6 6 0 0 1 12 0v2M12 7V4M9 5.5 8 3m7 2.5L16 3M5 10h14"/></svg>;
  if (name === "stock") return <svg {...common}><path d="M5 7h14v12H5zM8 7V5h8v2M8 12h8M8 16h5"/></svg>;
  if (name === "buffet") return <svg {...common}><path d="M4 15h16M6 15a6 6 0 0 1 12 0M12 8V5M10.5 5h3M5 19h14"/></svg>;
  if (name === "tax") return <svg {...common}><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/><path d="M10 19h4"/></svg>;
  if (name === "sales") return <svg {...common}><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h8"/><path d="m15 12 1.5 1.5L19 11"/></svg>;
  if (name === "documents") return <svg {...common}><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5M10 12h6M10 16h6"/></svg>;
  return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5"/><circle cx="17" cy="10" r="2.2"/><path d="M14.5 17.5c.7-1.4 1.9-2.2 3.5-2.2 1.3 0 2.4.5 3.1 1.5"/></svg>;
}

export function PosMoreWorkspace({ lang, role }: { lang: Language; role: PosRole }) {
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
  const [menuPolicy, setMenuPolicy] = useState<Record<string, boolean>>({});
  const [opticalMoreAccess, setOpticalMoreAccess] = useState<Record<string, boolean>>({});
  const [isCustom, setIsCustom] = useState(false);
  const [policyReady, setPolicyReady] = useState(false);
  const [policyError, setPolicyError] = useState("");
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [packageLockOpen, setPackageLockOpen] = useState(false);
  const [itLockedMenu, setItLockedMenu] = useState<string | null>(null);
  const items = MORE_ITEMS.filter((item) => item.roles.includes(role));

  useEffect(() => {
    let cancelled = false;
    async function loadFeatures() {
      try {
        const response = await fetch("/api/pos/features?refresh=1", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { data?: { features?: Record<string, boolean>; menu_policy?: Record<string, boolean>; is_custom?: boolean; optical_more_access?: Record<string, boolean> } | null } | null;
        if (!response.ok || !body?.data?.features || !body.data.menu_policy) {
          throw new Error("Failed to load POS menu policy");
        }
        if (!cancelled) {
          setEnabledFeatures(body.data.features);
          setMenuPolicy(body.data.menu_policy);
          setOpticalMoreAccess(body.data.optical_more_access ?? {});
          setIsCustom(body.data.is_custom === true);
          setPolicyReady(true);
          setPolicyError("");
        }
      } catch {
        if (!cancelled) {
          setPolicyReady(false); // Fail closed rather than rendering wrong package menus.
          setEnabledFeatures(null);
          setPolicyError(lang === "th" ? "ไม่สามารถโหลดสิทธิ์เมนูจากระบบได้ กรุณาลองอีกครั้ง" : "Unable to load POS menu permissions. Please retry.");
        }
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
  }, [refreshCounter, lang]);

  function isMenuLocked(href: string) {
    return !isPosMenuEnabled(posMenuKeyForRoute(href) ?? "", menuPolicy);
  }

  function isLocked(href: string) {
    // Only the exact IT-approved CUSTOM Optical route has this additional access.
    // Ordinary packages and unrelated advanced-report APIs keep their feature gates.
    if (isCustom && opticalMoreAccess[href] === true && !isMenuLocked(href)) return false;
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
        {policyError ? <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {policyError} <button type="button" className="ml-2 font-semibold underline" onClick={() => setRefreshCounter(n => n + 1)}>
            {lang === "en" ? "Retry" : "ลองอีกครั้ง"}
          </button>
        </div> : null}
        {!policyReady && !policyError ? <p role="status" className="text-sm text-slate-600">{lang === "en" ? "Loading menu permissions..." : "กำลังตรวจสอบสิทธิ์เมนู..."}</p> : null}
        {policyReady && !items.some(item => !isCustom || isCustomPosMenuVisible(posMenuKeyForRoute(item.href) ?? "", menuPolicy, true))
          ? <p role="status" className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              {lang === "en" ? "No additional menus have been enabled for this store by IT." : "ยังไม่มีเมนูย่อยที่ IT เปิดให้ร้านนี้"}
            </p> : null}
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            if (!policyReady) return null;
            // IT controls visibility; package entitlements control whether the link is usable.
            // Never hide an IT-approved CUSTOM menu just because its package feature is locked.
            if (isCustom && !isCustomPosMenuVisible(posMenuKeyForRoute(item.href) ?? "", menuPolicy, true)) return null;
            const menuLocked = isMenuLocked(item.href);
            const locked = menuLocked || isLocked(item.href);
            const label = lang === "lo" ? moreLao[item.href]?.label ?? t(lang,item.labelKey!) : item.label ? item.label[lang] : t(lang, item.labelKey!);
            return (
              <Link key={item.href} href={item.href} prefetch={false} onClick={(event) => { if (menuLocked) { event.preventDefault(); setItLockedMenu(label); } else if (locked) handleLocked(event); }} aria-disabled={locked} className={`group grid min-h-[92px] grid-cols-[42px_1fr_24px] items-center gap-3 rounded-2xl border p-4 text-left transition ${locked ? "border-slate-200 bg-slate-50 text-slate-500" : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50"}`}>
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${locked ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700"}`}><MoreIcon name={item.icon}/></span>
                <span className="min-w-0"><span className="block text-base font-black text-slate-950">{label}</span><span className="mt-1 block text-sm font-medium leading-5 text-slate-500">{lang === "lo" ? moreLao[item.href]?.desc ?? item.desc.en : item.desc[lang]}</span>
                {isLocked(item.href) ? <span className="mt-1 block text-xs font-semibold text-amber-700">{lang === "en" ? "Enabled by IT · additional package entitlement required" : "IT เปิดเมนูแล้ว · ยังไม่มีสิทธิ์ฟีเจอร์ในแพ็กเกจ"}</span> : null}</span>
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

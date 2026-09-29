"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MouseEvent, useMemo } from "react";
import { t, type Language } from "@/lib/i18n";
import { isPosMenuEnabled, posMenuKeyForRoute } from "@/lib/pos-menu-policy";
import { POS_MENU_LOCK_TITLE_EN, POS_MENU_LOCK_TITLE_TH, featureForPosRoute } from "@/lib/pos-feature-map";

type IconName = "sales" | "list" | "kitchen" | "shift" | "more" | "payment" | "ai";
type PosRole = "owner" | "manager" | "staff" | "accountant" | "kitchen";
type MenuKey = "pos_menu_sales" | "pos_menu_sales_list" | "pos_menu_shift";
type MenuDef = {
  key: MenuKey | null;
  labelTh?: string;
  labelEn?: string;
  href: string;
  icon: IconName;
  roles: PosRole[];
  feature: ReturnType<typeof featureForPosRoute> | null;
};

function LockIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

function MenuIcon({ name }: { name: IconName }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "sales") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
  if (name === "list") return <svg {...common}><line x1="9" y1="7" x2="20" y2="7" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="17" x2="20" y2="17" /><circle cx="5" cy="7" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="17" r="1" /></svg>;
  if (name === "kitchen") return <svg {...common}><path d="M4 19h16" /><path d="M6 19v-2a6 6 0 0 1 12 0v2" /><path d="M12 7V4" /><path d="M9 5.5 8 3" /><path d="m15 5.5 1-2.5" /><path d="M5 10h14" /></svg>;
  if (name === "shift") return <svg {...common}><circle cx="12" cy="12" r="8" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="12" x2="15" y2="14" /></svg>;
  if (name === "more") return <svg {...common}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>;
  if (name === "payment") return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><path d="M7 15h3" /><path d="M15 15h2" /></svg>;
  return <svg {...common}><path d="M12 3l1.2 3.1L16 7.3l-2.8 1.2L12 12l-1.2-3.5L8 7.3l2.8-1.2L12 3Z" /><path d="M5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" /><path d="M18 12l.9 2.4L21 15.3l-2.1.9L18 19l-.9-2.8-2.1-.9 2.1-.9L18 12Z" /></svg>;
}

const MENU_DEFS: MenuDef[] = [
  { key: "pos_menu_sales", href: "/preview/pos", icon: "sales", roles: ["owner", "manager", "staff"], feature: featureForPosRoute("/preview/pos") },
  { key: "pos_menu_sales_list", href: "/preview/pos/sales-list", icon: "list", roles: ["owner", "manager", "staff"], feature: featureForPosRoute("/preview/pos/sales-list") },
  { key: null, labelTh: "ครัว", labelEn: "Kitchen", href: "/preview/pos/kitchen", icon: "kitchen", roles: ["owner", "manager", "staff", "kitchen"], feature: null },
  { key: "pos_menu_shift", href: "/preview/pos/shift", icon: "shift", roles: ["owner", "manager", "staff"], feature: featureForPosRoute("/preview/pos/shift") }
];

const MORE_CHILD_ROUTES = [
  "/preview/pos/sales-summary",
  "/preview/pos/receipts",
  "/preview/pos/tables",
  "/preview/pos/kitchen/manage",
  "/preview/pos/stock",
  "/preview/pos/buffet-pricing",
  "/preview/pos/members",
  "/preview/pos/tax-invoices",
  "/preview/pos/product-sales"
];

function resolveMenuRole(role: PosRole | null): PosRole {
  if (!role) return "owner";
  if (role === "accountant") return "manager";
  return role;
}

function labelFor(item: MenuDef, lang: Language) {
  if (item.key) return t(lang, item.key);
  return lang === "th" ? item.labelTh ?? "ครัว" : item.labelEn ?? "Kitchen";
}

function entryClass(args: { active: boolean; locked: boolean; horizontal: boolean; collapsed: boolean; accent?: boolean }) {
  const { active, locked, horizontal, collapsed, accent } = args;
  const layout = horizontal
    ? "shrink-0 justify-center gap-2 px-3"
    : collapsed
      ? "justify-center px-2"
      : "justify-start gap-2 px-2";
  const state = active
    ? accent
      ? "rounded-xl border border-cyan-300/55 bg-[linear-gradient(145deg,rgba(37,99,235,0.72),rgba(6,182,212,0.52))] text-white shadow-[0_10px_24px_rgba(14,116,255,0.3)]"
      : "rounded-xl border border-cyan-300/45 bg-[linear-gradient(145deg,rgba(59,130,246,0.45),rgba(14,165,233,0.35))] text-white shadow-[0_10px_24px_rgba(14,116,255,0.25),inset_0_1px_0_rgba(255,255,255,0.2)]"
    : locked
      ? "rounded-xl text-slate-400/85 hover:bg-white/5 hover:text-slate-200"
      : accent
        ? "rounded-xl text-cyan-100 hover:bg-cyan-400/10 hover:text-white"
        : "rounded-xl text-slate-100/90 hover:bg-white/8 hover:text-white";
  return `group relative inline-flex min-h-[42px] items-center text-[13px] font-semibold leading-tight transition ${layout} ${state}`;
}

export function PosStaffMenu({ lang, collapsed, orientation = "vertical", sessionRole, enabledFeatures, menuPolicy, onLockedFeature, onLockedMenu }: {
  lang: Language;
  collapsed: boolean;
  orientation?: "vertical" | "horizontal";
  sessionRole: PosRole | null;
  enabledFeatures: Record<string, boolean> | null;
  menuPolicy: Record<string, boolean>;
  onLockedFeature: () => void;
  onLockedMenu: (menuLabel: string) => void;
}) {
  const pathname = usePathname();
  const effectiveRole = resolveMenuRole(sessionRole);
  const menuItems = useMemo(
    () => MENU_DEFS.map((item) => ({ ...item, label: labelFor(item, lang) })).filter((item) => item.roles.includes(effectiveRole)),
    [effectiveRole, lang]
  );
  const isHorizontal = orientation === "horizontal";
  const aiVisible = sessionRole === "owner" || sessionRole === "manager";
  const aiLabel = lang === "th" ? "CpiPOS AI ผู้ช่วยร้านค้า" : "CpiPOS AI Store Assistant";
  const aiPolicyLocked = !isPosMenuEnabled("main.ai_assistant", menuPolicy);
  const aiFeature = featureForPosRoute("/preview/pos/ai-assistant");
  const aiFeatureLocked = Boolean(enabledFeatures !== null && aiFeature && enabledFeatures?.[aiFeature] === false);
  const moreVisible = effectiveRole === "owner" || effectiveRole === "manager";
  const morePolicyLocked = !isPosMenuEnabled("main.more", menuPolicy);
  const isMoreActive = pathname === "/preview/pos/more" || MORE_CHILD_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"));
  const billingLabel = lang === "th" ? "ชำระแพ็กเกจ" : "Package Payment";
  const billingPolicyLocked = !isPosMenuEnabled("main.package_payment", menuPolicy);

  function handleNavigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (pathname === href) event.preventDefault();
  }

  function renderLock(locked: boolean) {
    if (!locked) return null;
    return <span className={`ml-auto inline-flex text-slate-300 ${collapsed && !isHorizontal ? "absolute right-1 top-1" : ""}`}><LockIcon /></span>;
  }

  return (
    <nav className={isHorizontal ? "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-contain" : "grid gap-1"} aria-label={t(lang, "pos_menu_staff_aria")} suppressHydrationWarning>
      {menuItems.map((item) => {
        const active = pathname === item.href;
        const menuLocked = !isPosMenuEnabled(posMenuKeyForRoute(item.href) ?? "", menuPolicy);
        const featureLocked = Boolean(enabledFeatures !== null && item.feature && enabledFeatures?.[item.feature] === false);
        const locked = menuLocked || featureLocked;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={(event) => menuLocked ? (event.preventDefault(), onLockedMenu(item.label)) : featureLocked ? (event.preventDefault(), onLockedFeature()) : handleNavigate(event, item.href)}
            className={entryClass({ active, locked, horizontal: isHorizontal, collapsed })}
            title={collapsed && !isHorizontal ? item.label : menuLocked ? (lang === "th" ? "ล็อกโดยผู้ดูแลระบบ IT" : "Locked by IT") : featureLocked ? (lang === "th" ? POS_MENU_LOCK_TITLE_TH : POS_MENU_LOCK_TITLE_EN) : undefined}
            aria-disabled={locked}
          >
            <span className="inline-flex w-4 justify-center" aria-hidden><MenuIcon name={item.icon} /></span>
            {(!collapsed || isHorizontal) ? <span className="truncate text-[13px]">{item.label}</span> : null}
            {renderLock(locked)}
          </Link>
        );
      })}

      {aiVisible ? (
        <Link
          href="/preview/pos/ai-assistant"
          onClick={(event) => aiPolicyLocked ? (event.preventDefault(), onLockedMenu(aiLabel)) : aiFeatureLocked ? (event.preventDefault(), onLockedFeature()) : handleNavigate(event, "/preview/pos/ai-assistant")}
          className={entryClass({ active: pathname === "/preview/pos/ai-assistant", locked: aiPolicyLocked || aiFeatureLocked, horizontal: isHorizontal, collapsed, accent: true })}
          title={aiPolicyLocked ? (lang === "th" ? "ล็อกโดยผู้ดูแลระบบ IT" : "Locked by IT") : aiFeatureLocked ? (lang === "th" ? POS_MENU_LOCK_TITLE_TH : POS_MENU_LOCK_TITLE_EN) : aiLabel}
          aria-disabled={aiPolicyLocked || aiFeatureLocked}
        >
          <span className="inline-flex w-4 justify-center text-cyan-200" aria-hidden><MenuIcon name="ai" /></span>
          {(!collapsed || isHorizontal) ? <span className={`${isHorizontal ? "max-w-[170px]" : "min-w-0 flex-1"} truncate text-[13px]`}>{aiLabel}</span> : null}
          {renderLock(aiPolicyLocked || aiFeatureLocked)}
        </Link>
      ) : null}

      {moreVisible ? (
        <Link
          href="/preview/pos/more"
          onClick={(event) => morePolicyLocked ? (event.preventDefault(), onLockedMenu(t(lang, "pos_menu_more"))) : handleNavigate(event, "/preview/pos/more")}
          className={entryClass({ active: isMoreActive, locked: morePolicyLocked, horizontal: isHorizontal, collapsed })}
          title={collapsed && !isHorizontal ? t(lang, "pos_menu_more") : morePolicyLocked ? (lang === "th" ? "ล็อกโดยผู้ดูแลระบบ IT" : "Locked by IT") : undefined}
          aria-disabled={morePolicyLocked}
        >
          <span className="inline-flex w-4 justify-center" aria-hidden><MenuIcon name="more" /></span>
          {(!collapsed || isHorizontal) ? <span className="truncate text-[13px]">{t(lang, "pos_menu_more")}</span> : null}
          {renderLock(morePolicyLocked)}
        </Link>
      ) : null}

      {(sessionRole === "owner" || sessionRole === "manager") ? (
        <Link
          href="/preview/pos/payments/package"
          onClick={(event) => billingPolicyLocked ? (event.preventDefault(), onLockedMenu(billingLabel)) : handleNavigate(event, "/preview/pos/payments/package")}
          className={entryClass({ active: pathname === "/preview/pos/payments/package", locked: billingPolicyLocked, horizontal: isHorizontal, collapsed })}
          title={collapsed && !isHorizontal ? billingLabel : billingPolicyLocked ? (lang === "th" ? "ล็อกโดยผู้ดูแลระบบ IT" : "Locked by IT") : undefined}
          aria-disabled={billingPolicyLocked}
        >
          <span className="inline-flex w-4 justify-center" aria-hidden><MenuIcon name="payment" /></span>
          {(!collapsed || isHorizontal) ? <span className="truncate text-[13px]">{billingLabel}</span> : null}
          {renderLock(billingPolicyLocked)}
        </Link>
      ) : null}
    </nav>
  );
}

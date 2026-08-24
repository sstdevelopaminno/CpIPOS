"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Language } from "@/lib/i18n";

const SLOT_ATTRIBUTE = "data-cpipos-table-qr-settings-slot";
const CUSTOMER_DISPLAY_HREF = "/preview/pos/customer-display";
const SETTINGS_LANGUAGE_LABELS = ["เปลี่ยนภาษา", "Change Language"] as const;

function TableQrMenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5" cy="6" r="1.5" /><circle cx="5" cy="12" r="1.5" /><circle cx="5" cy="18" r="1.5" /><path d="M9 6h10M9 12h10M9 18h10" />
    </svg>
  );
}

function findCustomerDisplayCard() { return document.querySelector<HTMLAnchorElement>(`a[href="${CUSTOMER_DISPLAY_HREF}"]`); }
function findSettingsMenuGrid() {
  const languageCard = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => SETTINGS_LANGUAGE_LABELS.some((label) => String(button.textContent ?? "").includes(label)));
  return languageCard?.parentElement ?? null;
}
function ensureTableQrSettingsSlot() {
  const customerDisplayCard = findCustomerDisplayCard();
  const grid = customerDisplayCard?.parentElement ?? findSettingsMenuGrid();
  if (!grid) return null;
  const existing = grid.querySelector<HTMLElement>(`[${SLOT_ATTRIBUTE}]`);
  if (existing) return existing;
  const slot = document.createElement("div");
  slot.setAttribute(SLOT_ATTRIBUTE, "true");
  slot.className = "contents";
  if (customerDisplayCard?.parentElement === grid) customerDisplayCard.insertAdjacentElement("afterend", slot);
  else grid.appendChild(slot);
  return slot;
}

const cardClass = "group grid h-full min-h-[92px] grid-cols-[42px_1fr_24px] items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/50";

export function TableQrSettingsMenuPortal({ lang, timelineEnabled = false }: { lang: Language; timelineEnabled?: boolean }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let disposed = false;
    let currentSlot: HTMLElement | null = null;
    const sync = () => { if (!disposed && !currentSlot?.isConnected) { currentSlot = ensureTableQrSettingsSlot(); setTarget(currentSlot); } };
    sync();
    const observer = new MutationObserver(sync); observer.observe(document.body, { childList: true, subtree: true });
    return () => { disposed = true; observer.disconnect(); setTarget(null); if (currentSlot?.isConnected) currentSlot.remove(); };
  }, []);
  if (!target) return null;
  return createPortal(<>
    <Link href="/preview/pos/settings/table-qr" prefetch={false} className={cardClass}>
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700"><TableQrMenuIcon /></span>
      <span className="min-w-0"><span className="block text-base font-black text-slate-950">{lang === "th" ? "ตั้งค่า QR โต๊ะ" : "Table QR Settings"}</span><span className="mt-1 block text-sm font-medium leading-5 text-slate-500">{lang === "th" ? "กำหนดหมดอายุตามเวลา/ชั่วโมง หรือใช้งานตามบิล" : "Choose timed/hourly expiry or bill-lifecycle mode"}</span></span><span className="text-slate-400">›</span>
    </Link>
    {timelineEnabled ? <Link href="/preview/pos/settings/table-qr/timeline" prefetch={false} className={cardClass}>
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700 group-hover:bg-amber-100"><TimelineIcon /></span>
      <span className="min-w-0"><span className="block text-base font-black text-slate-950">{lang === "th" ? "ไทม์ไลน์สั่งอาหารจาก QR" : "QR Order Timeline"}</span><span className="mt-1 block text-sm font-medium leading-5 text-slate-500">{lang === "th" ? "ดูเครื่องที่กด รายการที่สั่ง สำเร็จ/ล้มเหลว/กดซ้ำ ย้อนหลัง 7 วัน" : "Audit device, items, success/failure and duplicate attempts for 7 days"}</span></span><span className="text-slate-400">›</span>
    </Link> : null}
  </>, target);
}

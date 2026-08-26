"use client";

import { useEffect } from "react";

const FF0001_TENANT_ID = "997a0329-604f-49eb-a091-e654a57e6b8e";
const POS_SCOPE_KEY = "pos_scope_v001";
const SELECTOR_QUERY = ".posui-mode-selector";
const GRID_QUERY = ".posui-mode-selector__grid";
const ORDER_BUTTON_QUERY = ".pos-mode-order-button";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const HIDDEN_ATTRIBUTE = "data-pos-mode-hidden";

type SalesMode = "home" | "dine_in" | "buffet_table" | "delivery";

function isFf0001Scope() {
  try {
    const tenantId = String(window.localStorage.getItem(POS_SCOPE_KEY) ?? "").split(":", 1)[0]?.trim();
    return tenantId === FF0001_TENANT_ID;
  } catch {
    return false;
  }
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function detectMode(element: HTMLElement): SalesMode | null {
  const text = normalizeLabel(element.textContent ?? "");
  if (!text) return null;

  if (text.includes("เดลิเวอรี่") || text.includes("delivery")) return "delivery";
  if (text.includes("บุฟเฟ่ต์") || text.includes("buffet")) return "buffet_table";
  if (text.includes("นั่งโต๊ะ") || text.includes("dine in") || text.includes("dine-in")) return "dine_in";
  if (
    text.includes("กลับบ้าน") ||
    text.includes("รับกลับ") ||
    text.includes("take away") ||
    text.includes("takeaway") ||
    text.includes("to go")
  ) {
    return "home";
  }
  return null;
}

function showBuffetOnly(element: HTMLElement) {
  element.setAttribute(MODE_ATTRIBUTE, "buffet_table");
  element.removeAttribute(HIDDEN_ATTRIBUTE);
  element.removeAttribute("aria-hidden");

  // The generic mode preference enhancer may temporarily attach the hidden attribute
  // using its legacy DOM-index mapping. Inline !important keeps the actual buffet card
  // visible even if that attribute is briefly re-applied during selector initialization.
  element.style.setProperty("display", "flex", "important");
}

function hideMode(element: HTMLElement, mode: SalesMode | null) {
  if (mode) element.setAttribute(MODE_ATTRIBUTE, mode);
  element.setAttribute(HIDDEN_ATTRIBUTE, "true");
  element.setAttribute("aria-hidden", "true");
  element.style.setProperty("display", "none", "important");
}

function applyFf0001Policy() {
  if (!isFf0001Scope()) return;

  for (const selector of document.querySelectorAll<HTMLElement>(SELECTOR_QUERY)) {
    const grid = selector.querySelector<HTMLElement>(GRID_QUERY);
    if (!grid) continue;

    const cards = Array.from(grid.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
    const buffetCard = cards.find((element) => detectMode(element) === "buffet_table") ?? null;

    // Fail safe: never blank the selector if the buffet card has not rendered yet.
    if (!buffetCard) continue;

    for (const element of cards) {
      const mode = detectMode(element);
      if (element === buffetCard || mode === "buffet_table") {
        showBuffetOnly(element);
      } else {
        hideMode(element, mode);
      }
    }

    // FF0001 has one allowed sales mode, so arranging mode order has no useful action.
    const orderButton = selector.querySelector<HTMLElement>(ORDER_BUTTON_QUERY);
    orderButton?.style.setProperty("display", "none", "important");
  }
}

export function PosFf0001SalesModeGuard() {
  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        applyFf0001Policy();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();

    // Re-assert while the generic branch preference enhancer finishes mounting.
    const timers = [50, 150, 300, 700, 1500, 2500, 5000].map((delay) => window.setTimeout(schedule, delay));

    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return null;
}

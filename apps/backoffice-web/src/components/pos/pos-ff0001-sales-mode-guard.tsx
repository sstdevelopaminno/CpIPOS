"use client";

import { useEffect } from "react";

const FF0001_TENANT_ID = "997a0329-604f-49eb-a091-e654a57e6b8e";
const POS_SCOPE_KEY = "pos_scope_v001";
const SELECTOR_QUERY = ".posui-mode-selector";
const GRID_QUERY = ".posui-mode-selector__grid";
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

function applyFf0001Policy() {
  if (!isFf0001Scope()) return;

  for (const selector of document.querySelectorAll<HTMLElement>(SELECTOR_QUERY)) {
    const grid = selector.querySelector<HTMLElement>(GRID_QUERY);
    if (!grid) continue;

    for (const element of Array.from(grid.children)) {
      if (!(element instanceof HTMLElement)) continue;
      const mode = detectMode(element);
      if (!mode) continue;

      // The generic preference enhancer historically inferred modes from DOM index.
      // FF0001's rendered selector order is different, so bind the semantic mode from
      // the actual rendered label before applying the tenant policy.
      element.setAttribute(MODE_ATTRIBUTE, mode);

      const hidden = mode === "delivery" || mode === "dine_in";
      if (hidden) {
        element.setAttribute(HIDDEN_ATTRIBUTE, "true");
        element.setAttribute("aria-hidden", "true");
        element.style.setProperty("display", "none", "important");
      } else {
        element.removeAttribute(HIDDEN_ATTRIBUTE);
        element.removeAttribute("aria-hidden");
        element.style.removeProperty("display");
      }
    }
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

    // Re-assert briefly because the branch preference enhancer can finish after the
    // selector first mounts. This is bounded and does not poll for the lifetime of POS.
    const timers = [100, 300, 700, 1500].map((delay) => window.setTimeout(schedule, delay));

    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return null;
}

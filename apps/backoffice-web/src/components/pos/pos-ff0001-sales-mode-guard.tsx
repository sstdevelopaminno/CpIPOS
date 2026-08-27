"use client";

import { useEffect } from "react";
import { fetchCurrentProductProfile, readCachedProductProfile } from "@/lib/pos-product-profile-client";
import { getProductProfilePolicy, type ProductProfileCode } from "@/lib/product-profile-policy";
import { parsePosScopeIdentity, type PosSalesMode } from "@/lib/pos-sales-mode-preferences";

const POS_SCOPE_KEY = "pos_scope_v001";
const SELECTOR_QUERY = ".posui-mode-selector";
const GRID_QUERY = ".posui-mode-selector__grid";
const ORDER_BUTTON_QUERY = ".pos-mode-order-button";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const HIDDEN_ATTRIBUTE = "data-pos-mode-hidden";

type SalesMode = PosSalesMode;

function readScope() {
  try {
    return parsePosScopeIdentity(window.localStorage.getItem(POS_SCOPE_KEY));
  } catch {
    return null;
  }
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function detectMode(element: HTMLElement): SalesMode | null {
  const text = normalizeLabel(element.textContent ?? "");
  if (!text) return null;

  if (text.includes("เน€เธ”เธฅเธดเน€เธงเธญเธฃเธตเน") || text.includes("delivery")) return "delivery";
  if (text.includes("เธเธธเธเน€เธเนเธ•เน") || text.includes("buffet")) return "buffet_table";
  if (text.includes("เธเธฑเนเธเนเธ•เนเธฐ") || text.includes("dine in") || text.includes("dine-in")) return "dine_in";
  if (
    text.includes("เธเธฅเธฑเธเธเนเธฒเธ") ||
    text.includes("เธฃเธฑเธเธเธฅเธฑเธ") ||
    text.includes("take away") ||
    text.includes("takeaway") ||
    text.includes("to go")
  ) {
    return "home";
  }
  return null;
}

function showMode(element: HTMLElement, mode: SalesMode) {
  element.setAttribute(MODE_ATTRIBUTE, mode);
  element.removeAttribute(HIDDEN_ATTRIBUTE);
  element.removeAttribute("aria-hidden");
  element.style.removeProperty("display");
}

function hideMode(element: HTMLElement, mode: SalesMode | null) {
  if (mode) element.setAttribute(MODE_ATTRIBUTE, mode);
  element.setAttribute(HIDDEN_ATTRIBUTE, "true");
  element.setAttribute("aria-hidden", "true");
  element.style.setProperty("display", "none", "important");
}

function applyProductProfilePolicy(productProfile: ProductProfileCode | null) {
  if (!productProfile) return;
  const policy = getProductProfilePolicy(productProfile);
  if (policy.hiddenSalesModes.length === 0) return;
  const hidden = new Set(policy.hiddenSalesModes);

  for (const selector of document.querySelectorAll<HTMLElement>(SELECTOR_QUERY)) {
    const grid = selector.querySelector<HTMLElement>(GRID_QUERY);
    if (!grid) continue;

    const cards = Array.from(grid.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
    for (const element of cards) {
      const mode = detectMode(element) ?? (element.getAttribute(MODE_ATTRIBUTE) as SalesMode | null);
      if (mode && hidden.has(mode)) hideMode(element, mode);
      else if (mode) showMode(element, mode);
    }

    if (policy.forcePreferredSalesMode) {
      const orderButton = selector.querySelector<HTMLElement>(ORDER_BUTTON_QUERY);
      orderButton?.style.setProperty("display", "none", "important");
    }
  }
}

export function PosFf0001SalesModeGuard() {
  useEffect(() => {
    let raf = 0;
    let activeScopeKey = "";
    let productProfile: ProductProfileCode | null = null;

    const refreshProfile = () => {
      const scope = readScope();
      const scopeKey = scope ? `${scope.tenantId}:${scope.branchId}` : "";
      if (scopeKey === activeScopeKey && productProfile) return;
      activeScopeKey = scopeKey;
      productProfile = readCachedProductProfile(scope?.tenantId);
      if (scope?.tenantId) {
        void fetchCurrentProductProfile(scope.tenantId).then((profile) => {
          if (profile && activeScopeKey === scopeKey) {
            productProfile = profile;
            schedule();
          }
        });
      }
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        refreshProfile();
        applyProductProfilePolicy(productProfile);
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();

    const timers = [50, 150, 300, 700, 1500, 2500, 5000].map((delay) => window.setTimeout(schedule, delay));

    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return null;
}

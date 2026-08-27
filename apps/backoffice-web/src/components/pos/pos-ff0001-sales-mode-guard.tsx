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
const PROFILE_REFRESH_RETRY_COOLDOWN_MS = 15_000;

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

  if (text.includes("เดลิเวอรี่") || text.includes("เดลิเวอรี") || text.includes("delivery")) return "delivery";
  if (text.includes("บุฟเฟต์") || text.includes("บุฟเฟ่ต์") || text.includes("buffet")) return "buffet_table";
  if (text.includes("นั่งโต๊ะ") || text.includes("ทานที่ร้าน") || text.includes("dine in") || text.includes("dine-in")) return "dine_in";
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

    const orderButton = selector.querySelector<HTMLElement>(ORDER_BUTTON_QUERY);
    if (policy.forcePreferredSalesMode) orderButton?.style.setProperty("display", "none", "important");
    else orderButton?.style.removeProperty("display");
  }
}

export function PosFf0001SalesModeGuard() {
  useEffect(() => {
    let raf = 0;
    let activeScopeKey = "";
    let productProfile: ProductProfileCode | null = null;
    let profileRequestScopeKey = "";
    let profileRequestInFlight = false;
    let profileRetryAfter = 0;

    const refreshProfile = () => {
      const scope = readScope();
      const scopeKey = scope ? `${scope.tenantId}:${scope.branchId}` : "";

      if (scopeKey !== activeScopeKey) {
        activeScopeKey = scopeKey;
        productProfile = readCachedProductProfile(scope?.tenantId);
        profileRequestScopeKey = "";
        profileRequestInFlight = false;
        profileRetryAfter = 0;
      } else if (!productProfile) {
        productProfile = readCachedProductProfile(scope?.tenantId);
      }

      if (!scope?.tenantId || productProfile) return;
      if (profileRequestInFlight && profileRequestScopeKey === scopeKey) return;
      if (profileRequestScopeKey === scopeKey && profileRetryAfter > Date.now()) return;

      profileRequestScopeKey = scopeKey;
      profileRequestInFlight = true;
      void fetchCurrentProductProfile(scope.tenantId)
        .then((profile) => {
          if (activeScopeKey !== scopeKey) return;
          if (profile) {
            productProfile = profile;
            profileRetryAfter = 0;
            schedule();
          } else {
            profileRetryAfter = Date.now() + PROFILE_REFRESH_RETRY_COOLDOWN_MS;
          }
        })
        .finally(() => {
          if (profileRequestScopeKey === scopeKey) profileRequestInFlight = false;
        });
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

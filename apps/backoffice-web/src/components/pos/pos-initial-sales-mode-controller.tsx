"use client";

import { useEffect } from "react";
import {
  buildPosSalesModeOrderStorageKey,
  getPreferredPosSalesMode,
  getVisiblePosSalesModeOrder,
  getAuthorizedCustomPosStartupMode,
  type PosStartupSalesMode,
  normalizePosSalesModeOrder,
  parsePosScopeIdentity,
  shouldForcePreferredPosSalesMode,
  type PosSalesMode
} from "@/lib/pos-sales-mode-preferences";
import { fetchCurrentProductProfile, readCachedProductProfile } from "@/lib/pos-product-profile-client";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";
import { normalizeCustomPosSalesModes } from "@/lib/pos-sales-modes";

const POS_SCOPE_KEY = "pos_scope_v001";
const SALES_MODE_ORDER_API = "/api/pos/settings/sales-mode-order";
const FEATURES_API = "/api/pos/features?refresh=1";
const MODE_SWITCH_QUERY = ".posui-mode-switch-button";
const MODE_SELECTOR_QUERY = ".posui-mode-selector";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const HIDDEN_ATTRIBUTE = "data-pos-mode-hidden";
const WAIT_STEP_MS = 100;
const SCOPE_WAIT_LIMIT = 50;
const SELECTOR_WAIT_LIMIT = 40;

const ACTIVE_POS_KEYS = [
  "pos_pending_submit_v012",
  "pos_pending_submit_queue_v001",
  "pos_pending_payment_queue_v001",
  "pos_active_order_v001",
  "pos_dine_in_selected_table_v001"
] as const;

function hasMeaningfulJsonArray(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
  } catch {
    return true;
  }
}

function hasActivePosWork(): boolean {
  try {
    if (hasMeaningfulJsonArray(window.localStorage.getItem("pos_sales_cart_v012"))) return true;
    return ACTIVE_POS_KEYS.some((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return false;
      if (key.includes("queue")) return hasMeaningfulJsonArray(raw);
      return raw.trim().length > 0 && raw !== "null" && raw !== "{}" && raw !== "[]";
    });
  } catch {
    // Storage uncertainty must never trigger a generic automatic mode transition.
    return true;
  }
}

type PosFeaturesSnapshot = {
  data?: {
    is_custom?: boolean;
    is_internal_test_full?: boolean;
    sales_modes?: unknown;
    features?: Record<string, boolean>;
  } | null;
};

function readScope() {
  try {
    return parsePosScopeIdentity(window.localStorage.getItem(POS_SCOPE_KEY));
  } catch {
    return null;
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function parseModeOrder(payload: unknown): PosSalesMode[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return normalizePosSalesModeOrder((data as { order?: unknown }).order);
}

function findRenderedBuffetCard(): HTMLElement | null {
  const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
  if (!selector) return null;
  const candidates = Array.from(selector.querySelectorAll<HTMLElement>("button, [role=button]"));
  return (
    candidates.find((candidate) => {
      const text = String(candidate.textContent ?? "").toLowerCase();
      return text.includes("บุฟเฟต์") || text.includes("บุฟเฟ่ต์") || text.includes("buffet");
    }) ?? null
  );
}

export function PosInitialSalesModeController() {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      let scope = readScope();
      for (let index = 0; !scope && index < SCOPE_WAIT_LIMIT && !cancelled; index += 1) {
        await wait(WAIT_STEP_MS);
        scope = readScope();
      }
      if (!scope || cancelled) return;

      // Startup must use a fresh IT entitlement snapshot, not a stale mode order.
      let customPolicy = false;
      let customModeGrants: unknown = null;
      try {
        const response = await fetch(FEATURES_API, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store"
        });
        if (!response.ok || cancelled) return;
        const payload = (await response.json().catch(() => null)) as PosFeaturesSnapshot | null;
        if (!payload?.data || cancelled) return;
        customPolicy = payload.data.is_custom === true || payload.data.is_internal_test_full === true;
        if (customPolicy) {
          const grants = normalizeCustomPosSalesModes(payload.data.sales_modes);
          const features = payload.data.features ?? {};
          customModeGrants = {
            ...grants,
            optical_retail: grants.optical_retail && features.core_pos_sales === true,
            general_sale: grants.general_sale && features[POS_MODE_FEATURES.general_sale] === true,
            dine_in: grants.dine_in && features[POS_MODE_FEATURES.dine_in] === true,
            buffet_table: grants.buffet_table && features[POS_MODE_FEATURES.buffet_table] === true,
            delivery: grants.delivery && features[POS_MODE_FEATURES.delivery] === true
          };
        }
      } catch {
        // No automatic navigation from unverified or stale permissions.
        return;
      }

      let productProfile = readCachedProductProfile(scope.tenantId);
      const fetchedProfile = await fetchCurrentProductProfile(scope.tenantId);
      if (cancelled) return;
      productProfile = fetchedProfile ?? productProfile;
      const forcePreferredMode = shouldForcePreferredPosSalesMode(productProfile);
      const forcedPreferredMode = getPreferredPosSalesMode(productProfile);
      const hasBlockingWork = () => !forcePreferredMode && hasActivePosWork();

      // Generic tenants keep the conservative restore guard. Product profiles may
      // force a safe starting mode so stale local storage cannot pin a terminal to the wrong flow.
      if (hasBlockingWork()) return;

      let order: PosSalesMode[] | null = null;
      try {
        const response = await fetch(SALES_MODE_ORDER_API, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store"
        });
        if (response.ok) {
          const payload = (await response.json().catch(() => null)) as unknown;
          order = parseModeOrder(payload);
          if (order) {
            try {
              window.localStorage.setItem(buildPosSalesModeOrderStorageKey(scope), JSON.stringify(order));
            } catch {
              // Cache is optional; the server result is authoritative for this startup.
            }
          }
        }
      } catch {
        // Fail soft to the cached branch preference below.
      }

      if (!order) {
        try {
          const raw = window.localStorage.getItem(buildPosSalesModeOrderStorageKey(scope));
          if (raw) order = normalizePosSalesModeOrder(JSON.parse(raw));
        } catch {
          order = null;
        }
      }
      if ((!order && !forcePreferredMode && !customPolicy) || cancelled || hasBlockingWork()) return;

      const authorizedCustomMode = customPolicy
        ? getAuthorizedCustomPosStartupMode(order ?? [], productProfile, customModeGrants)
        : null;
      // A CUSTOM store with no allowed modes must not silently enter takeaway.
      if (customPolicy && !authorizedCustomMode) return;
      const preferred: PosStartupSalesMode = customPolicy
        ? authorizedCustomMode!
        : forcePreferredMode
          ? forcedPreferredMode
          : getVisiblePosSalesModeOrder(order ?? [], scope.tenantId, productProfile).find((mode) => mode !== "delivery") ?? "home";
      if (preferred === "home") return;

      let switchButton: HTMLButtonElement | null = null;
      for (let index = 0; !switchButton && index < SELECTOR_WAIT_LIMIT && !cancelled; index += 1) {
        const candidate = document.querySelector<HTMLButtonElement>(MODE_SWITCH_QUERY);
        if (candidate && !candidate.disabled) switchButton = candidate;
        if (!switchButton) await wait(WAIT_STEP_MS);
      }
      if (!switchButton || cancelled || hasBlockingWork()) return;

      switchButton.click();

      for (let index = 0; index < SELECTOR_WAIT_LIMIT && !cancelled; index += 1) {
        if (hasBlockingWork()) return;
        let target = document.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="${preferred}"]`);

        // Buffet product profiles must be resilient to legacy DOM-index tagging.
        // Resolve the actual rendered Buffet card by its label when the generic enhancer has not settled yet.
        if (forcePreferredMode && preferred === "buffet_table" && (!target || target.getAttribute(HIDDEN_ATTRIBUTE) === "true")) {
          target = findRenderedBuffetCard();
        }

        const blockedByIt = target?.getAttribute("data-it-custom-mode-hidden") === "1"
          || target?.getAttribute("data-it-sales-mode-locked") === "1";
        if (target && !blockedByIt && ((forcePreferredMode && !customPolicy) || target.getAttribute(HIDDEN_ATTRIBUTE) !== "true")) {
          target.click();
          return;
        }
        await wait(WAIT_STEP_MS);
      }

      // If the selector enhancer is unavailable, close the selector without mutating sales state.
      document.querySelector<HTMLButtonElement>(".posui-mode-selector__close")?.click();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

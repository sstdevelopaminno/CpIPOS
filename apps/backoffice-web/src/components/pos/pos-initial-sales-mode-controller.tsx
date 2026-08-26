"use client";

import { useEffect } from "react";
import {
  buildPosSalesModeOrderStorageKey,
  getVisiblePosSalesModeOrder,
  normalizePosSalesModeOrder,
  parsePosScopeIdentity,
  type PosSalesMode
} from "@/lib/pos-sales-mode-preferences";

const POS_SCOPE_KEY = "pos_scope_v001";
const SALES_MODE_ORDER_API = "/api/pos/settings/sales-mode-order";
const MODE_SWITCH_QUERY = ".posui-mode-switch-button";
const MODE_SELECTOR_QUERY = ".posui-mode-selector";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const HIDDEN_ATTRIBUTE = "data-pos-mode-hidden";
const WAIT_STEP_MS = 100;
const SCOPE_WAIT_LIMIT = 50;
const SELECTOR_WAIT_LIMIT = 40;
const FF0001_TENANT_ID = "997a0329-604f-49eb-a091-e654a57e6b8e";

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
      return text.includes("บุฟเฟ่ต์") || text.includes("บุฟเฟ่") || text.includes("buffet");
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

      const forceBuffetOnly = scope.tenantId === FF0001_TENANT_ID;
      const hasBlockingWork = () => !forceBuffetOnly && hasActivePosWork();

      // Generic tenants keep the conservative restore guard. FF0001 is explicitly
      // buffet-only, so stale takeaway/localStorage state must not pin the terminal to Home.
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
      if ((!order && !forceBuffetOnly) || cancelled || hasBlockingWork()) return;

      const preferred: PosSalesMode = forceBuffetOnly
        ? "buffet_table"
        : getVisiblePosSalesModeOrder(order ?? [], scope.tenantId).find((mode) => mode !== "delivery") ?? "home";
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

        // FF0001 must be resilient to legacy DOM-index tagging. Resolve the actual
        // rendered Buffet card by its label when the generic enhancer has not settled yet.
        if (forceBuffetOnly && (!target || target.getAttribute(HIDDEN_ATTRIBUTE) === "true")) {
          target = findRenderedBuffetCard();
        }

        if (target && (forceBuffetOnly || target.getAttribute(HIDDEN_ATTRIBUTE) !== "true")) {
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

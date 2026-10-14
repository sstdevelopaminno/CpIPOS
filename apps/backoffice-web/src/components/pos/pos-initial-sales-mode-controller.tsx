"use client";

import { useEffect, useState } from "react";
import {
  buildPosSalesModeOrderStorageKey,
  getPreferredPosSalesMode,
  getVisiblePosSalesModeOrder,
  getAuthorizedCustomPosStartupMode,
  normalizePosSalesModeOrder,
  parsePosScopeIdentity,
  shouldForcePreferredPosSalesMode,
  type PosSalesMode,
  type PosStartupSalesMode
} from "@/lib/pos-sales-mode-preferences";
import { fetchCurrentProductProfile, readCachedProductProfile } from "@/lib/pos-product-profile-client";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";
import { normalizeCustomPosSalesModes } from "@/lib/pos-sales-modes";
import {
  POS_STARTUP_MODE_REQUEST_EVENT,
  POS_STARTUP_MODE_RESULT_EVENT,
  type PosStartupModeRequest,
  type PosStartupModeResult
} from "@/lib/pos-general-sale-mode";

const POS_SCOPE_KEY = "pos_scope_v001";
const SALES_MODE_ORDER_API = "/api/pos/settings/sales-mode-order";
const FEATURES_API = "/api/pos/features?refresh=1";
const MODE_SWITCH_QUERY = ".posui-mode-switch-button";
const WAIT_STEP_MS = 100;
const SCOPE_WAIT_LIMIT = 50;
const MODE_READY_WAIT_LIMIT = 50;
const ACTIVATION_TIMEOUT_MS = 8000;

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
    // On storage uncertainty, never reset an in-flight bill to change modes.
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

async function activateModeWithoutDialog(
  mode: PosStartupSalesMode,
  isCancelled: () => boolean
): Promise<boolean> {
  for (let index = 0; index < MODE_READY_WAIT_LIMIT && !isCancelled(); index += 1) {
    if (document.querySelector<HTMLButtonElement>(MODE_SWITCH_QUERY)) break;
    await wait(WAIT_STEP_MS);
  }
  if (isCancelled() || !document.querySelector(MODE_SWITCH_QUERY)) return false;

  const requestId = crypto.randomUUID();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener(POS_STARTUP_MODE_RESULT_EVENT, onResult as EventListener);
      resolve(success);
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<PosStartupModeResult>).detail;
      if (detail?.requestId !== requestId || detail.mode !== mode) return;
      finish(detail.activated === true);
    };
    window.addEventListener(POS_STARTUP_MODE_RESULT_EVENT, onResult as EventListener);
    const timeoutId = window.setTimeout(() => finish(false), ACTIVATION_TIMEOUT_MS);
    if (isCancelled()) {
      finish(false);
      return;
    }
    const detail: PosStartupModeRequest = { requestId, mode };
    window.dispatchEvent(new CustomEvent<PosStartupModeRequest>(POS_STARTUP_MODE_REQUEST_EVENT, { detail }));
  });
}

export function PosInitialSalesModeController() {
  const [attempt, setAttempt] = useState(0);
  const [startupStatus, setStartupStatus] = useState<"pending" | "ready" | "error">("pending");

  useEffect(() => {
    let cancelled = false;
    const complete = (status: "ready" | "error") => {
      if (!cancelled) setStartupStatus(status);
    };
    const run = async () => {
      let scope = readScope();
      for (let i = 0; !scope && i < SCOPE_WAIT_LIMIT && !cancelled; i += 1) {
        await wait(WAIT_STEP_MS);
        scope = readScope();
      }
      if (cancelled) return;
      if (!scope) return complete("error");

      // The authenticated IT policy (not browser storage) selects CUSTOM modes.
      let customPolicy = false;
      let customModeGrants: unknown = null;
      try {
        const response = await fetch(FEATURES_API, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store"
        });
        if (!response.ok || cancelled) return complete("error");
        const payload = (await response.json().catch(() => null)) as PosFeaturesSnapshot | null;
        if (!payload?.data || cancelled) return complete("error");
        customPolicy = payload.data.is_custom === true || payload.data.is_internal_test_full === true;
        if (customPolicy) {
          const grants = normalizeCustomPosSalesModes(payload.data.sales_modes);
          const features = payload.data.features ?? {};
          customModeGrants = {
            ...grants,
            takeaway: grants.takeaway && features.core_pos_sales === true,
            optical_retail: grants.optical_retail && features.core_pos_sales === true,
            general_sale: grants.general_sale && features[POS_MODE_FEATURES.general_sale] === true,
            dine_in: grants.dine_in && features[POS_MODE_FEATURES.dine_in] === true,
            buffet_table: grants.buffet_table && features[POS_MODE_FEATURES.buffet_table] === true,
            delivery: grants.delivery && features[POS_MODE_FEATURES.delivery] === true
          };
        }
      } catch {
        return complete("error");
      }

      let productProfile = readCachedProductProfile(scope.tenantId);
      try {
        const fetchedProfile = await fetchCurrentProductProfile(scope.tenantId);
        if (fetchedProfile) productProfile = fetchedProfile;
      } catch {
        // Product-profile fetch may fail; CUSTOM still uses fresh IT grants.
      }
      if (cancelled) return;
      const forcePreferredMode = shouldForcePreferredPosSalesMode(productProfile);
      const forcedPreferredMode = getPreferredPosSalesMode(productProfile);
      const hasBlockingWork = () => !forcePreferredMode && hasActivePosWork();

      // Do not reset a retained bill or queued payment just to change screens.
      if (hasBlockingWork()) return complete("ready");

      let order: PosSalesMode[] | null = null;
      try {
        const response = await fetch(SALES_MODE_ORDER_API, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store"
        });
        if (response.ok) {
          order = parseModeOrder(await response.json().catch(() => null));
          if (order) {
            try {
              window.localStorage.setItem(buildPosSalesModeOrderStorageKey(scope), JSON.stringify(order));
            } catch {
              // Optional cache is not an authorization source.
            }
          }
        }
      } catch {
        // Use the cached ordering as a display preference only.
      }
      if (!order) {
        try {
          const raw = window.localStorage.getItem(buildPosSalesModeOrderStorageKey(scope));
          if (raw) order = normalizePosSalesModeOrder(JSON.parse(raw));
        } catch {
          order = null;
        }
      }

      if (cancelled) return;
      if (!customPolicy && !order && !forcePreferredMode) return complete("ready");

      const authorizedCustomMode = customPolicy
        ? getAuthorizedCustomPosStartupMode(order ?? [], productProfile, customModeGrants)
        : null;
      if (customPolicy && !authorizedCustomMode) return complete("error");

      const preferred: PosStartupSalesMode = customPolicy
        ? authorizedCustomMode!
        : forcePreferredMode
          ? forcedPreferredMode
          : getVisiblePosSalesModeOrder(order ?? [], scope.tenantId, productProfile).find((mode) => mode !== "delivery") ?? "home";

      if (preferred === "home") return complete("ready");
      const activated = await activateModeWithoutDialog(preferred, () => cancelled || hasBlockingWork());
      if (!cancelled) complete(activated ? "ready" : "error");
    };

    void run().catch(() => complete("error"));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (startupStatus === "ready") return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-50 px-6"
      role={startupStatus === "error" ? "alert" : "status"}
      aria-live="polite"
      data-testid="pos-startup-mode-gate"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-lg">
        <strong className="block text-lg font-bold text-slate-900">กำลังเตรียมหน้าขาย CpiPOS</strong>
        {startupStatus === "pending" ? (
          <p className="mt-3 text-sm text-slate-600">กำลังตรวจสิทธิ์และเปิดโหมดขายที่ได้รับอนุญาต…</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-red-700">ยังไม่สามารถยืนยันหรือเปิดโหมดขายที่ได้รับอนุญาต กรุณาตรวจสอบการเชื่อมต่อหรือสิทธิ์ใน IT Admin</p>
            <button
              type="button"
              className="mt-5 rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white"
              onClick={() => {
                setStartupStatus("pending");
                setAttempt((current) => current + 1);
              }}
            >
              ตรวจสอบสิทธิ์อีกครั้ง
            </button>
          </>
        )}
      </div>
    </div>
  );
}

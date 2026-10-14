"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  buildPosSalesModeOrderStorageKey,
  getPreferredPosSalesMode,
  getVisiblePosSalesModeOrder,
  getAuthorizedCustomPosStartupMode,
  normalizePosSalesModeOrder,
  parsePosScopeIdentity,
  shouldForcePreferredPosSalesMode,
  type PosSalesMode,
  type PosScopeIdentity,
  type PosStartupSalesMode
} from "@/lib/pos-sales-mode-preferences";
import { fetchCurrentProductProfile, readCachedProductProfile } from "@/lib/pos-product-profile-client";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";
import { isAuthorizedOpticalRetailMode, normalizeCustomPosSalesModes } from "@/lib/pos-sales-modes";

const POS_SCOPE_KEY = "pos_scope_v001";
const SALES_MODE_ORDER_API = "/api/pos/settings/sales-mode-order";
const FEATURES_API = "/api/pos/features?refresh=1";
const WAIT_STEP_MS = 100;
const SCOPE_WAIT_LIMIT = 50;
const ACTIVATION_TIMEOUT_MS = 30000;
const FEATURE_RETRY_DELAYS_MS = [250, 650] as const;

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

/** Retry only transient feature-service failures; a 401/403 is authoritative.
 * Never use localStorage grants or a disabled legacy selling mode as fallback.
 */
async function readFreshStartupFeatures(isCancelled: () => boolean): Promise<PosFeaturesSnapshot | null> {
  for (let attempt = 0; attempt <= FEATURE_RETRY_DELAYS_MS.length && !isCancelled(); attempt += 1) {
    try {
      const response = await fetch(FEATURES_API, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      });
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as PosFeaturesSnapshot | null;
        if (body?.data) return body;
      }
      if (response.status === 401 || response.status === 403 || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return null;
      }
    } catch {
      // Temporary offline/transport failure; try again briefly.
    }
    if (attempt < FEATURE_RETRY_DELAYS_MS.length) await wait(FEATURE_RETRY_DELAYS_MS[attempt]);
  }
  return null;
}

function parseModeOrder(payload: unknown): PosSalesMode[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return normalizePosSalesModeOrder((data as { order?: unknown }).order);
}

/**
 * The authenticated POS session/shift gate mounts this controller before the
 * dynamic React sales module. Server entitlements choose ONE initial mode.
 * Its child receives that mode as a React prop and acknowledges AFTER commit.
 * Neither authorization nor the initial selection depends on DOM selectors,
 * event timing, a mounted takeaway button or a separate scanner controller.
 */
export function PosInitialSalesModeController({
  initialScope,
  lang,
  SalesComponent
}: {
  initialScope?: PosScopeIdentity | null;
  lang: "th" | "en";
  SalesComponent: ComponentType<{lang?: "th" | "en"; startupMode?: PosStartupSalesMode; onStartupModeReady?: (mode: PosStartupSalesMode) => void}>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [startupStatus, setStartupStatus] = useState<"pending" | "ready" | "error">("pending");
  const [startupFailureCode, setStartupFailureCode] = useState<string | null>(null);
  const [authorizedMode, setAuthorizedMode] = useState<PosStartupSalesMode | null>(null);
  const activeModeRef = useRef<PosStartupSalesMode | null>(null);

  const onReady = useCallback((mode: PosStartupSalesMode) => {
    // Ignore a stale child from a prior Session/branch or retry.
    if (mode !== activeModeRef.current) return;
    setStartupFailureCode(null);
    setStartupStatus("ready");
  }, []);

  useEffect(() => {
    if (!authorizedMode || startupStatus !== "pending") return;
    const timer = window.setTimeout(() => {
      setStartupFailureCode("POS-START-REACT");
      setStartupStatus("error");
    }, ACTIVATION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [authorizedMode, startupStatus]);

  useEffect(() => {
    let cancelled = false;
    activeModeRef.current = null;
    const fail = (failureCode: string) => {
      if (cancelled) return;
      activeModeRef.current = null;
      setAuthorizedMode(null);
      setStartupFailureCode(failureCode);
      setStartupStatus("error");
    };
    const run = async () => {
      let scope = initialScope?.tenantId && initialScope.branchId ? initialScope : readScope();
      for (let i = 0; !scope && i < SCOPE_WAIT_LIMIT && !cancelled; i += 1) {
        await wait(WAIT_STEP_MS);
        scope = initialScope?.tenantId && initialScope.branchId ? initialScope : readScope();
      }
      if (cancelled) return;
      if (!scope) return fail("POS-START-SCOPE");

      const payload = await readFreshStartupFeatures(() => cancelled);
      if (cancelled) return;
      if (!payload?.data) return fail("POS-START-FEATURES");
      const customPolicy = payload.data.is_custom === true || payload.data.is_internal_test_full === true;
      let customModeGrants: unknown = null;
      if (customPolicy) {
        const grants = normalizeCustomPosSalesModes(payload.data.sales_modes);
        const features = payload.data.features ?? {};
        customModeGrants = {
          ...grants,
          takeaway: grants.takeaway && features.core_pos_sales === true,
          optical_retail: isAuthorizedOpticalRetailMode(payload.data),
          general_sale: grants.general_sale && features[POS_MODE_FEATURES.general_sale] === true,
          dine_in: grants.dine_in && features[POS_MODE_FEATURES.dine_in] === true,
          buffet_table: grants.buffet_table && features[POS_MODE_FEATURES.buffet_table] === true,
          delivery: grants.delivery && features[POS_MODE_FEATURES.delivery] === true
        };
      }
      let productProfile = readCachedProductProfile(scope.tenantId);
      try {
        const fetchedProfile = await fetchCurrentProductProfile(scope.tenantId);
        if (fetchedProfile) productProfile = fetchedProfile;
      } catch {
        // A profile lookup cannot grant a disabled CUSTOM mode.
      }
      if (cancelled) return;
      let order: PosSalesMode[] | null = null;
      try {
        const response = await fetch(SALES_MODE_ORDER_API, {
          method: "GET", credentials: "same-origin", cache: "no-store"
        });
        if (response.ok) {
          order = parseModeOrder(await response.json().catch(() => null));
          if (order) {
            try {
              window.localStorage.setItem(buildPosSalesModeOrderStorageKey(scope), JSON.stringify(order));
            } catch { /* Display order is optional and never grants a mode. */ }
          }
        }
      } catch { /* Fall back to display order only. */ }
      if (!order) {
        try {
          const raw = window.localStorage.getItem(buildPosSalesModeOrderStorageKey(scope));
          if (raw) order = normalizePosSalesModeOrder(JSON.parse(raw));
        } catch { order = null; }
      }
      if (cancelled) return;
      const authorizedCustomMode = customPolicy
        ? getAuthorizedCustomPosStartupMode(order ?? [], productProfile, customModeGrants)
        : null;
      if (customPolicy && !authorizedCustomMode) return fail("POS-START-GRANTS");
      const forcePreferred = shouldForcePreferredPosSalesMode(productProfile);
      const mode: PosStartupSalesMode = customPolicy
        ? authorizedCustomMode!
        : forcePreferred
          ? getPreferredPosSalesMode(productProfile)
          : getVisiblePosSalesModeOrder(order ?? [], scope.tenantId, productProfile)
              .find((entry) => entry !== "delivery") ?? "home";
      // A restored cart is NOT an authorization bypass. The child applies the
      // authorized mode without submitting or deleting any existing transaction.
      activeModeRef.current = mode;
      setAuthorizedMode(mode);
    };
    void run().catch(() => fail("POS-START-UNEXPECTED"));
    return () => {
      cancelled = true;
      activeModeRef.current = null;
    };
  }, [attempt, initialScope?.tenantId, initialScope?.branchId]);

  // The IT admin can revoke a mode while an existing POS tab is open. The
  // server-backed policy refresh event fails closed, including for Optical.
  useEffect(() => {
    if (!authorizedMode) return;
    const onPolicyUpdated = (event: Event) => {
      const data = (event as CustomEvent<PosFeaturesSnapshot["data"]>).detail;
      if (!data || !(data.is_custom || data.is_internal_test_full)) return;
      const granted = normalizeCustomPosSalesModes(data.sales_modes);
      const modeKey = authorizedMode === "home" ? "takeaway" : authorizedMode;
      if (granted[modeKey] === true) return;
      activeModeRef.current = null;
      setAuthorizedMode(null);
      setStartupFailureCode("POS-START-GRANTS");
      setStartupStatus("error");
    };
    window.addEventListener("cpipos:pos-feature-policy-updated", onPolicyUpdated);
    return () => window.removeEventListener("cpipos:pos-feature-policy-updated", onPolicyUpdated);
  }, [authorizedMode]);

  return (
    <>
      {authorizedMode ? <SalesComponent lang={lang} startupMode={authorizedMode} onStartupModeReady={onReady} /> : null}
      {startupStatus !== "ready" ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-50 px-6"
          role={startupStatus === "error" ? "alert" : "status"}
          aria-live="polite" data-testid="pos-startup-mode-gate">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-lg">
            <strong className="block text-lg font-bold text-slate-900">กำลังเตรียมหน้าขาย CpiPOS</strong>
            {startupStatus === "pending" ? (
              <p className="mt-3 text-sm text-slate-600">กำลังตรวจสิทธิ์และเปิดโหมดขายที่ได้รับอนุญาต…</p>
            ) : (
              <>
                <p className="mt-3 text-sm text-red-700">
                  {startupFailureCode === "POS-START-REACT"
                    ? "ระบบตรวจสิทธิ์ผ่านแล้ว แต่ React ยังไม่ยืนยันการเปิดหน้าขาย โปรดตรวจสอบสถานะหน้าขาย"
                    : startupFailureCode === "POS-START-FEATURES"
                      ? "โหลดสิทธิ์จากเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบ Session หรือการเชื่อมต่อ"
                      : "ยังไม่สามารถเปิดโหมดขายที่ได้รับอนุญาต กรุณาตรวจสอบสิทธิ์ใน IT Admin"}
                </p>
                {startupFailureCode
                  ? <p className="mt-2 font-mono text-xs text-slate-500" data-testid="pos-startup-failure-code">รหัสตรวจสอบ: {startupFailureCode}</p>
                  : null}
                <button type="button" className="mt-5 rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white"
                  onClick={() => {
                    activeModeRef.current = null;
                    setAuthorizedMode(null);
                    setStartupStatus("pending");
                    setStartupFailureCode(null);
                    setAttempt((current) => current + 1);
                  }}>ตรวจสอบสิทธิ์อีกครั้ง</button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

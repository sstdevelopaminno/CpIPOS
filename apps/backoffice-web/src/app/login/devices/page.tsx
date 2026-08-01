"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { PreEntryShell } from "@/components/pre-entry/pre-entry-shell";
import { clearPreEntryClientCache, warmRoute } from "@/lib/pre-entry-client-cache";

type DeviceItem = {
  deviceCode: string;
  deviceId: string;
  deviceName: string;
  counterName: string;
  status: "ready" | "in_use" | "offline" | "disabled";
  lastConnectedAt: string | null;
  currentUser: { id: string; name: string } | null;
};

type DevicesResponse = {
  data?: {
    branch: { name: string | null };
    employee?: { id: string | null; code?: string | null; name?: string | null; role?: string | null };
    devices: DeviceItem[];
    single_device_mode: boolean;
    auto_select_single_device?: boolean;
    can_override_in_use: boolean;
  } | null;
  error?: { code: string; message: string } | null;
};

type SelectDeviceResponse = {
  data?: { redirect_to: string } | null;
  error?: { code: string; message: string } | null;
};

type PopupState =
  | { type: "none" }
  | { type: "loading"; message: string }
  | { type: "error"; message: string };

const AUTH_REQUEST_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 20000 : 15000;
const DEVICE_SELECT_REQUEST_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 60000 : 45000;
const POS_ENTRY_GATE_SKIP_SPLASH_KEY = "pos_skip_entry_gate_overlay_once_v1";
const SPLASH_LOGO_SRC = "/brand/cpipos-symbol-transparent.png";

function statusLabel(status: DeviceItem["status"]) {
  if (status === "ready") return "พร้อมใช้งาน";
  if (status === "in_use") return "กำลังใช้งาน";
  if (status === "offline") return "ออฟไลน์";
  return "ปิดใช้งาน";
}

function canSelectDevice(device: DeviceItem, canOverride: boolean, employeeId: string) {
  if (device.status === "ready") return true;
  if (device.status === "in_use") return canOverride || (Boolean(employeeId) && device.currentUser?.id === employeeId);
  return false;
}

function mapDeviceError(code?: string | null, fallback?: string | null) {
  if (code === "device_required") return "กรุณาเลือกเครื่องแคชเชียร์";
  if (code === "missing_employee_context") return "กรุณายืนยันผู้ใช้งานก่อนเลือกเครื่อง";
  if (code === "feature_not_enabled") return "แพ็กเกจปัจจุบันยังไม่รองรับการเข้าใช้งานหน้าขาย";
  if (code === "device_not_found") return "ไม่พบเครื่องที่เลือกในสาขานี้";
  if (code === "device_disabled") return "เครื่องที่เลือกถูกปิดใช้งาน";
  if (code === "device_offline") return "เครื่องที่เลือกออฟไลน์หรืออยู่ระหว่างบำรุงรักษา";
  if (code === "device_in_use") return "เครื่องนี้ยังมีผู้ใช้งานค้างอยู่ พนักงานขายต้องเลือกเครื่องอื่น หรือให้ผู้จัดการ/เจ้าของร้านเข้าแทน";
  if (code === "device_scope_denied") return "ผู้ใช้งานนี้ไม่ได้รับสิทธิ์ใช้เครื่องที่เลือก";
  if (code === "session_scope_conflict") return "เครื่องนี้กำลังถูกใช้งานอยู่";
  if (code === "context_create_failed") return "ไม่สามารถเตรียมบริบทการล็อคอินได้";
  if (code === "session_creation_failed") return "ไม่สามารถสร้าง POS Session ได้";
  if (code === "auth_timeout") return "ระบบตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง";
  if (code === "device_select_failed") return "ไม่สามารถเข้าใช้งานเครื่องที่เลือกได้";
  return fallback ?? "ไม่สามารถเลือกเครื่องได้ในขณะนี้";
}

function isRetryableRequestError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return error instanceof TypeError;
}

function mapNetworkErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "หมดเวลาการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง";
  }
  return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้";
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { cache: "no-store", ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchJsonWithRetry<T>(input: RequestInfo | URL, init?: RequestInit, attempts = 1, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, timeoutMs);
      const body = (await response.json().catch(() => null)) as T | null;
      return { response, body };
    } catch (error) {
      lastError = error;
      if (!isRetryableRequestError(error) || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 350 * attempt));
    }
  }

  throw lastError;
}

function LoginDevicesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const flow = searchParams.get("flow") === "single" ? "single" : "multi";
  const [branchName, setBranchName] = useState("");
  const [noBranchMode, setNoBranchMode] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [canOverride, setCanOverride] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<PopupState>({ type: "none" });
  const loadStartedRef = useRef(false);
  const autoSubmitCodeRef = useRef("");

  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    let mounted = true;
    void (async () => {
      try {
        const { response, body } = await fetchJsonWithRetry<DevicesResponse>("/api/auth/devices", undefined, 2);
        if (!response.ok || !body?.data) {
          if (mounted) {
            router.replace(`/login/employee?flow=${flow}`);
          }
          return;
        }

        const data = body.data;
        if (!mounted) return;

        const resolvedBranchName = data.branch.name ?? "";
        setBranchName(resolvedBranchName);
        setNoBranchMode(data.single_device_mode && resolvedBranchName === "Default Register");
        setEmployeeId(data.employee?.id ?? "");
        setDevices(data.devices);
        setCanOverride(data.can_override_in_use);

        if (data.devices.length === 0) {
          const message = "ไม่พบเครื่องแคชเชียร์ที่ใช้งานได้ในสาขานี้";
          setError(message);
          setPopup({ type: "error", message });
        }

        const firstReady = data.devices.find((device) => device.status === "ready");
        const firstAllowed =
          firstReady ??
          data.devices.find((device) => device.status === "in_use" && data.can_override_in_use) ??
          data.devices.find((device) => canSelectDevice(device, data.can_override_in_use, data.employee?.id ?? "")) ??
          data.devices[0];
        setSelectedCode(firstAllowed?.deviceCode ?? "");
        if (
          data.auto_select_single_device &&
          firstAllowed &&
          canSelectDevice(firstAllowed, data.can_override_in_use, data.employee?.id ?? "")
        ) {
          autoSubmitCodeRef.current = firstAllowed.deviceCode;
        }
      } catch (requestError) {
        if (mounted) {
          const message = mapNetworkErrorMessage(requestError);
          setError(message);
          setPopup({ type: "error", message });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [flow, router]);

  useEffect(() => {
    const preload = new window.Image();
    preload.src = SPLASH_LOGO_SRC;
    warmRoute(router, "/preview/pos");
  }, [router]);

  useEffect(() => {
    if (!submitting) return undefined;

    const slowTimer = window.setTimeout(() => {
      setPopup({ type: "loading", message: "กำลังตรวจสอบและปลดล็อก session เครื่อง..." });
    }, 4000);
    const timeoutTimer = window.setTimeout(() => {
      setPopup({ type: "loading", message: "ระบบยังประมวลผลอยู่ กรุณารอสักครู่..." });
    }, 10000);

    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [submitting]);


  useEffect(() => {
    if (loading || submitting || !autoSubmitCodeRef.current) return;
    const code = autoSubmitCodeRef.current;
    autoSubmitCodeRef.current = "";
    setSelectedCode(code);
    void handleSelectDevice(code);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, submitting]);
  const selectedDevice = useMemo(() => devices.find((device) => device.deviceCode === selectedCode) ?? null, [devices, selectedCode]);
  const selectedDeviceCanOpen = selectedDevice ? canSelectDevice(selectedDevice, canOverride, employeeId) : false;

  async function handleSelectDevice(deviceCodeOverride?: string) {
    if (submitting || loading) return;

    const targetDevice = deviceCodeOverride ? devices.find((device) => device.deviceCode === deviceCodeOverride) ?? null : selectedDevice;
    const targetCanOpen = targetDevice ? canSelectDevice(targetDevice, canOverride, employeeId) : false;

    if (!targetDevice) {
      const message = "กรุณาเลือกเครื่องแคชเชียร์";
      setError(message);
      setPopup({ type: "error", message });
      return;
    }

    if (!targetCanOpen) {
      const message = "เครื่องที่เลือกยังไม่พร้อมใช้งาน";
      setError(message);
      setPopup({ type: "error", message });
      return;
    }

    setSubmitting(true);
    setError("");
    const isOverridingDevice = targetDevice.status === "in_use";
    setPopup({
      type: "loading",
      message: isOverridingDevice ? "กำลังปลดล็อกเครื่องที่กำลังใช้งาน..." : "กำลังเปิดเครื่องแคชเชียร์..."
    });

    let hasFailure = false;
    let redirectTo = "";

    try {
      const { response, body } = await fetchJsonWithRetry<SelectDeviceResponse>(
        "/api/auth/devices/select",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_code: targetDevice.deviceCode,
          force_override: isOverridingDevice
        })
        },
        2,
        DEVICE_SELECT_REQUEST_TIMEOUT_MS
      );

      if (!response.ok || !body?.data?.redirect_to) {
        const message = mapDeviceError(body?.error?.code, body?.error?.message);
        setError(message);
        setPopup({ type: "error", message });
        hasFailure = true;
        return;
      }

      redirectTo = body.data.redirect_to;
    } catch (requestError) {
      const message = mapNetworkErrorMessage(requestError);
      setError(message);
      setPopup({ type: "error", message });
      hasFailure = true;
    } finally {
      if (redirectTo) {
        setPopup({ type: "loading", message: "กำลังเปิดหน้าระบบขาย..." });
        clearPreEntryClientCache();
        try {
          window.sessionStorage.setItem(POS_ENTRY_GATE_SKIP_SPLASH_KEY, "1");
        } catch {
          // Continue routing even if browser storage is unavailable.
        }
        window.location.assign(redirectTo);
      } else if (!hasFailure) {
        setSubmitting(false);
        setPopup({ type: "none" });
      } else {
        setSubmitting(false);
      }
    }
  }

  async function handleBack() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    clearPreEntryClientCache();
    let redirectTo = `/login/employee?flow=${flow}`;
    try {
      const response = await fetchWithTimeout("/api/auth/session/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "switch_employee" }),
        cache: "no-store"
      }, 5000);
      const body = (await response.json().catch(() => null)) as { data?: { redirect_to?: string } | null } | null;
      redirectTo = body?.data?.redirect_to ?? redirectTo;
    } catch {
      // Best-effort logout; still move the user back to employee verification.
    } finally {
      setSubmitting(false);
      warmRoute(router, redirectTo);
      router.replace(redirectTo);
    }
  }

  return (
    <PreEntryShell mode={flow} activeStep={flow === "multi" ? 4 : 3} title="" subtitle="" layout="store" showModePill={false} showStepbar={false}>
      {branchName ? (
        <p className="ipos-employee-branch ipos-employee-branch-with-icon">
          <span className="ipos-icon-box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 10V20H20V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M3 10L5 4H19L21 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 20V14H16V20" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M3 10C3 11.2 4 12 5.1 12C6.2 12 7 11.2 7 10C7 11.2 8 12 9.1 12C10.2 12 11 11.2 11 10C11 11.2 12 12 13.1 12C14.2 12 15 11.2 15 10C15 11.2 16 12 17.1 12C18.2 12 21 11.2 21 10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span>{noBranchMode ? "โหมดร้านเดี่ยว: ไม่มีการเลือกสาขา" : `สาขา: ${branchName}`}</span>
        </p>
      ) : null}
      {loading ? <p className="ipos-loading-text">กำลังโหลดรายการเครื่องแคชเชียร์...</p> : null}

      {!loading ? (
        <div className="ipos-branch-selector-card ipos-device-selector-card">
          <h3 className="ipos-branch-selector-title">เลือกเครื่องแคชเชียร์</h3>

          <div className="ipos-device-grid ipos-device-grid-compact">
            {devices.map((device) => {
              const disabled = !canSelectDevice(device, canOverride, employeeId);

              return (
                <button
                  key={device.deviceCode}
                  type="button"
                  className={`ipos-device-card ipos-device-card-compact ${selectedCode === device.deviceCode ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                  onClick={() => {
                    if (!disabled) {
                      setSelectedCode(device.deviceCode);
                      if (error) setError("");
                      if (popup.type === "error") setPopup({ type: "none" });
                    }
                  }}
                  disabled={disabled || submitting}
                >
                  <h3>{device.deviceName}</h3>
                  <p>
                    รหัสเครื่อง <strong>{device.deviceCode}</strong>
                  </p>
                  <p>{device.counterName}</p>
                  {device.currentUser ? <p className="ipos-device-warning">กำลังใช้งานโดย {device.currentUser.name}</p> : null}
                  <div className="ipos-mt-10">
                    <span className={`ipos-status ${device.status}`}>{statusLabel(device.status)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? <p className="ipos-error">{error}</p> : null}

      <div className="ipos-inline-actions ipos-branch-actions">
        <button type="button" className="ipos-outline-btn" onClick={() => void handleBack()} disabled={submitting}>
          ย้อนกลับ
        </button>
        <button type="button" className="ipos-primary-btn ipos-btn-compact" onClick={() => void handleSelectDevice()} disabled={submitting || loading || !selectedDeviceCanOpen}>
          {submitting ? "กำลังเข้าสู่ระบบ..." : "เปิดแคช"}
        </button>
      </div>

      {popup.type !== "none" ? (
        <div className="store-v2-popup-overlay" role="dialog" aria-modal="true" aria-live="polite">
          <div className="store-v2-popup-card">
            {popup.type === "loading" ? (
              <>
                <div className="ipos-entry-splash-logo" aria-hidden="true">
                  <Image src={SPLASH_LOGO_SRC} alt="" width={180} height={180} sizes="180px" priority />
                </div>
                <div className="store-v2-popup-spinner ipos-entry-splash-spinner" aria-hidden="true" />
                <p className="store-v2-popup-title">กำลังเปิดแคช</p>
                <p className="store-v2-popup-text">{popup.message}</p>
              </>
            ) : (
              <>
                <div className="store-v2-popup-error-icon" aria-hidden="true">
                  !
                </div>
                <p className="store-v2-popup-title">ดำเนินการไม่สำเร็จ</p>
                <p className="store-v2-popup-text">{popup.message}</p>
                <button type="button" className="store-v2-popup-close-btn" onClick={() => setPopup({ type: "none" })}>
                  ปิด
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </PreEntryShell>
  );
}

export default function LoginDevicesPage() {
  return (
    <Suspense
      fallback={
        <PreEntryShell mode="multi" activeStep={4} title="" subtitle="" layout="store" showModePill={false} showStepbar={false}>
          <p className="ipos-loading-text">กำลังโหลดรายการเครื่องแคชเชียร์...</p>
        </PreEntryShell>
      }
    >
      <LoginDevicesPageContent />
    </Suspense>
  );
}



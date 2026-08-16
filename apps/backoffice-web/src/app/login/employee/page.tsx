"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PreEntryShell } from "@/components/pre-entry/pre-entry-shell";
import { AppLanguageSwitcher } from "@/components/i18n/app-language-switcher";
import { useAppLanguage, type AppLanguage } from "@/lib/app-language-client";
import { readCachedSelectedBranch, warmRoute } from "@/lib/pre-entry-client-cache";

type FlowMode = "single" | "multi";

type SessionContextResponse = {
  data?: {
    stage: string;
    tenant: { id: string; code: string | null; name: string | null } | null;
    branch: { id: string; code: string | null; name: string | null } | null;
    employee: { id: string; name: string | null; code: string | null; role: string | null } | null;
  } | null;
  error?: { code: string; message: string } | null;
};

type VerifyCodeResponse = {
  data?: {
    next_step?: "devices" | "remembered_device" | "kitchen";
    remembered_device?: { id: string | null; code: string } | null;
  } | null;
  error?: { code?: string; message?: string } | null;
};

type DeviceSelectResponse = {
  data?: {
    redirect_to?: string;
    session_id?: string;
  } | null;
  error?: { code?: string; message?: string } | null;
};

type PopupState =
  | { type: "none" }
  | { type: "loading"; message: string }
  | { type: "error"; message: string };

const AUTH_REQUEST_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 20000 : 15000;

function getCopy(lang: AppLanguage) {
  if (lang === "en") {
    return {
      branchPrefix: "Branch",
      loadingContext: "Loading login context...",
      verifyLabel: "Employee code",
      verifyPlaceholder: "Code set by manager/owner",
      verifyButton: "Verify Employee",
      verifyingButton: "Verifying...",
      backButton: "Back",
      loadContextError: "Unable to load login context. Please retry.",
      connectError: "Unable to connect server.",
      requiredError: "Please enter employee code.",
      employeeNotFound: "Employee code was not found in this branch.",
      permissionDenied: "This employee does not have POS access permission.",
      featureNotEnabled: "Employee code login is not enabled for this branch.",
      missingBranchContext: "Please select branch before verifying employee.",
      invalidEmployeeCode: "Employee code must contain numbers only.",
      verifyFailed: "Unable to verify employee code.",
      popupCheckingTitle: "Checking",
      popupLoginTitle: "Logging in",
      popupCheckingUser: "Verifying employee identity...",
      popupEnteringPos: "Entering POS mode...",
      popupFailedTitle: "Action failed",
      popupClose: "Close",
      showCode: "Show employee code",
      hideCode: "Hide employee code"
    };
  }

  return {
    branchPrefix: "สาขา",
    loadingContext: "กำลังโหลดข้อมูลล็อกอิน...",
    verifyLabel: "รหัสพนักงาน",
    verifyPlaceholder: "รหัสที่ตั้งไว้โดยผู้จัดการ/เจ้าของร้าน",
    verifyButton: "ยืนยันพนักงาน",
    verifyingButton: "กำลังยืนยัน...",
    backButton: "ย้อนกลับ",
    loadContextError: "ไม่สามารถโหลดข้อมูลล็อกอินได้ กรุณาลองใหม่",
    connectError: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้",
    requiredError: "กรุณากรอกรหัสพนักงาน",
    employeeNotFound: "ไม่พบรหัสพนักงานนี้ในสาขา",
    permissionDenied: "พนักงานนี้ไม่มีสิทธิ์เข้าใช้งาน POS",
    featureNotEnabled: "สาขานี้ยังไม่เปิดใช้งานล็อกอินด้วยรหัสพนักงาน",
    missingBranchContext: "กรุณาเลือกสาขาก่อนยืนยันพนักงาน",
    invalidEmployeeCode: "รหัสพนักงานต้องเป็นตัวเลขเท่านั้น",
    verifyFailed: "ไม่สามารถยืนยันรหัสพนักงานได้",
    popupCheckingTitle: "กำลังตรวจสอบ",
    popupLoginTitle: "กำลังเข้าสู่ระบบ",
    popupCheckingUser: "กำลังยืนยันตัวตนพนักงาน...",
    popupEnteringPos: "กำลังเข้าโหมด POS...",
    popupFailedTitle: "ดำเนินการไม่สำเร็จ",
    popupClose: "ปิด",
    showCode: "แสดงรหัสพนักงาน",
    hideCode: "ซ่อนรหัสพนักงาน"
  };
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      {!open ? <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : null}
    </svg>
  );
}

function normalizeEmployeeCodeInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 32);
}

function mapVerifyCodeError(code: string | null | undefined, fallback: string | null | undefined, copy: ReturnType<typeof getCopy>) {
  if (code === "employee_code_required") return copy.requiredError;
  if (code === "employee_not_found") return copy.employeeNotFound;
  if (code === "permission_denied") return copy.permissionDenied;
  if (code === "feature_not_enabled") return copy.featureNotEnabled;
  if (code === "missing_branch_context") return copy.missingBranchContext;
  return fallback ?? copy.verifyFailed;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchJsonWithRetry<T>(input: RequestInfo | URL, init?: RequestInit, attempts = 2) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init);
      const body = (await response.json().catch(() => null)) as T | null;
      return { response, body };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof TypeError;
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 350 * attempt));
    }
  }

  throw lastError;
}

function LoginEmployeePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang, setLanguage } = useAppLanguage("th");
  const copy = useMemo(() => getCopy(lang), [lang]);
  const flow: FlowMode = searchParams.get("flow") === "single" ? "single" : "multi";

  const [contextLoading, setContextLoading] = useState(true);
  const [branchName, setBranchName] = useState("");
  const [employeeCode, setEmployeeCode] = useState(normalizeEmployeeCodeInput(searchParams.get("employee_code") ?? ""));
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<PopupState>({ type: "none" });
  const [showEmployeeCode, setShowEmployeeCode] = useState(false);
  const employeeCodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    const cachedBranch = readCachedSelectedBranch();
    if (cachedBranch) {
      setBranchName(cachedBranch.name ?? cachedBranch.code ?? cachedBranch.id);
      setContextLoading(false);
    }
    warmRoute(router, `/login/devices?flow=${flow}`);

    void (async () => {
      try {
        const response = await fetchWithTimeout("/api/auth/session/context", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as SessionContextResponse | null;
        if (!mounted) return;

        const stage = body?.data?.stage ?? "none";
        const branch = body?.data?.branch ?? null;
        const tenant = body?.data?.tenant ?? null;

        if (!branch || !tenant || (stage !== "branch_selected" && stage !== "employee_verified")) {
          router.replace(flow === "multi" ? "/login/branches?flow=multi" : "/login/store");
          return;
        }

        if (stage === "employee_verified") {
          if (String(body?.data?.employee?.role ?? "").trim().toLowerCase() === "kitchen") {
            try {
              const kitchenResponse = await fetchWithTimeout("/api/auth/kitchen/session", { method: "POST", cache: "no-store" });
              const kitchenBody = (await kitchenResponse.json().catch(() => null)) as DeviceSelectResponse | null;
              if (kitchenResponse.ok && kitchenBody?.data?.redirect_to) {
                window.location.assign(kitchenBody.data.redirect_to);
                return;
              }
            } catch {
              // Keep the verified context on-screen so the user can retry the normal submit path.
            }
          } else {
            router.replace(`/login/devices?flow=${flow}`);
            return;
          }
        }

        setBranchName(branch.name ?? branch.code ?? branch.id);
      } catch {
        if (!mounted) return;
        setError(copy.loadContextError);
      } finally {
        if (mounted) setContextLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [copy.loadContextError, flow, router]);

  async function handleVerifyByCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifyingCode) return;

    const normalizedCode = normalizeEmployeeCodeInput(employeeCode);
    if (!normalizedCode) {
      setError(copy.requiredError);
      setPopup({ type: "error", message: copy.requiredError });
      return;
    }
    if (employeeCode.trim() !== normalizedCode) {
      setEmployeeCode(normalizedCode);
      setError(copy.invalidEmployeeCode);
      setPopup({ type: "error", message: copy.invalidEmployeeCode });
      return;
    }

    setVerifyingCode(true);
    setError("");
    setPopup({ type: "loading", message: copy.popupCheckingUser });
    try {
      const { response, body } = await fetchJsonWithRetry<VerifyCodeResponse>("/api/auth/employee/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_code: normalizedCode })
      });
      if (!response.ok || !body?.data?.next_step) {
        const message = mapVerifyCodeError(body?.error?.code, body?.error?.message, copy);
        setError(message);
        setPopup({ type: "error", message });
        return;
      }

      setPopup({ type: "loading", message: copy.popupEnteringPos });
      if (body.data.next_step === "kitchen") {
        const { response: kitchenResponse, body: kitchenBody } = await fetchJsonWithRetry<DeviceSelectResponse>(
          "/api/auth/kitchen/session",
          { method: "POST", cache: "no-store" },
          1
        );
        const redirectTo = String(kitchenBody?.data?.redirect_to ?? "").trim();
        if (kitchenResponse.ok && redirectTo) {
          window.location.assign(redirectTo);
          return;
        }
        const message = kitchenBody?.error?.message ?? copy.verifyFailed;
        setError(message);
        setPopup({ type: "error", message });
        return;
      }

      const rememberedDeviceCode = String(body.data.remembered_device?.code ?? "").trim().toUpperCase();
      if (body.data.next_step === "remembered_device" && rememberedDeviceCode) {
        try {
          const { response: deviceResponse, body: deviceBody } = await fetchJsonWithRetry<DeviceSelectResponse>(
            "/api/auth/devices/select",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ device_code: rememberedDeviceCode }),
              cache: "no-store"
            },
            1
          );
          const redirectTo = String(deviceBody?.data?.redirect_to ?? "").trim();
          if (deviceResponse.ok && redirectTo) {
            window.location.assign(redirectTo);
            return;
          }
        } catch {
          // Fall through to manual device selection when the remembered device cannot be reused.
        }
      }

      warmRoute(router, `/login/devices?flow=${flow}`);
      router.push(`/login/devices?flow=${flow}`);
    } catch (requestError) {
      const message = requestError instanceof DOMException && requestError.name === "AbortError" ? copy.verifyFailed : copy.connectError;
      setError(message);
      setPopup({ type: "error", message });
    } finally {
      setVerifyingCode(false);
    }
  }

  async function handleBack() {
    setError("");
    await fetchWithTimeout("/api/auth/session/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "switch_employee" }),
      cache: "no-store"
    }, 5000).catch(() => null);
    router.replace(flow === "multi" ? "/login/branches?flow=multi" : "/login/store");
  }

  return (
    <PreEntryShell mode={flow} activeStep={flow === "multi" ? 3 : 2} title="" layout="store" showModePill={false} showStepbar={false}>
      <div className="store-v2-topbar">
        <AppLanguageSwitcher lang={lang} onChange={setLanguage} />
      </div>

      {branchName ? (
        <p className="ipos-employee-branch ipos-employee-branch-with-icon">
          <span className="ipos-icon-box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 10V20H20V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M3 10L5 4H19L21 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 20V14H16V20" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </span>
          <span>
            {copy.branchPrefix}: {branchName}
          </span>
        </p>
      ) : null}

      {contextLoading ? <p className="ipos-loading-text">{copy.loadingContext}</p> : null}

      {!contextLoading ? (
        <>
          <form className="ipos-form" onSubmit={handleVerifyByCode}>
            <label htmlFor="employeeCode">{copy.verifyLabel}</label>
            <div className="ipos-input-wrap ipos-input-wrap-compact ipos-input-wrap-with-toggle" onClick={() => employeeCodeInputRef.current?.focus()}>
              <input
                ref={employeeCodeInputRef}
                id="employeeCode"
                type={showEmployeeCode ? "text" : "password"}
                value={employeeCode}
                onChange={(event) => {
                  setEmployeeCode(normalizeEmployeeCodeInput(event.target.value));
                  if (error) setError("");
                  if (popup.type === "error") setPopup({ type: "none" });
                }}
                placeholder={copy.verifyPlaceholder}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                autoFocus
              />
              <button
                type="button"
                className="login-code-visibility-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowEmployeeCode((current) => !current);
                }}
                aria-label={showEmployeeCode ? copy.hideCode : copy.showCode}
                title={showEmployeeCode ? copy.hideCode : copy.showCode}
              >
                <EyeIcon open={showEmployeeCode} />
              </button>
            </div>
            <button type="submit" className="ipos-primary-btn ipos-btn-compact" disabled={verifyingCode}>
              {verifyingCode ? copy.verifyingButton : copy.verifyButton}
            </button>
          </form>

          <div className="ipos-inline-actions ipos-branch-actions">
            <button
              type="button"
              className="ipos-outline-btn ipos-btn-compact-secondary"
              onClick={() => void handleBack()}
            >
              {copy.backButton}
            </button>
          </div>
        </>
      ) : null}

      {error ? <p className="ipos-error">{error}</p> : null}

      {popup.type !== "none" ? (
        <div className="store-v2-popup-overlay" role="dialog" aria-modal="true" aria-live="polite">
          <div className="store-v2-popup-card">
            {popup.type === "loading" ? (
              <>
                <div className="store-v2-popup-spinner" aria-hidden="true" />
                <p className="store-v2-popup-title">{popup.message === copy.popupEnteringPos ? copy.popupLoginTitle : copy.popupCheckingTitle}</p>
                <p className="store-v2-popup-text">{popup.message}</p>
              </>
            ) : (
              <>
                <div className="store-v2-popup-error-icon" aria-hidden="true">
                  !
                </div>
                <p className="store-v2-popup-title">{copy.popupFailedTitle}</p>
                <p className="store-v2-popup-text">{popup.message}</p>
                <button type="button" className="store-v2-popup-close-btn" onClick={() => setPopup({ type: "none" })}>
                  {copy.popupClose}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </PreEntryShell>
  );
}

export default function LoginEmployeePage() {
  return (
    <Suspense
      fallback={
        <PreEntryShell mode="multi" activeStep={3} title="" layout="store" showModePill={false} showStepbar={false}>
          <p className="ipos-loading-text">Loading...</p>
        </PreEntryShell>
      }
    >
      <LoginEmployeePageContent />
    </Suspense>
  );
}

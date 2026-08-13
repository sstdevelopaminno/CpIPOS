"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AppLanguageSwitcher } from "@/components/i18n/app-language-switcher";
import { useAppLanguage, type AppLanguage } from "@/lib/app-language-client";
import { cacheBranches, clearPreEntryClientCache, warmRoute, type CachedBranch } from "@/lib/pre-entry-client-cache";

type StoreVerifyResponse = {
  data?: {
    next_step: "branches" | "employee";
    auto_skip_branch_selection: boolean;
    branches?: CachedBranch[];
  } | null;
  error?: {
    code: string;
    message: string;
  } | null;
};

type VerifyRequestResult = {
  response: Response;
  body: StoreVerifyResponse | null;
};

type PopupState =
  | { type: "none" }
  | { type: "loading"; message: string }
  | { type: "error"; message: string };

const AUTH_REQUEST_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 20000 : 15000;

function getCopy(lang: AppLanguage) {
  if (lang === "en") {
    return {
      subtitle: "Enter POS system",
      storeCodeLabel: "Store code",
      storeCodePlaceholder: "Enter store code",
      submit: "Log in",
      submitting: "Checking...",
      checking: "Checking store information...",
      checkingTitle: "Checking",
      close: "Close",
      failedTitle: "Login failed",
      requiredError: "Please enter store code.",
      formatError: "Store code format is invalid.",
      notFoundError: "Store code was not found or not yet activated.",
      rateLimitError: "Too many attempts. Please wait and try again.",
      verifyFailedError: "Unable to verify store code right now.",
      defaultError: "Cannot sign in. Please check store code.",
      timeoutError: "Request timeout. Please try again.",
      networkError: "Cannot connect to server.",
      cancel: "Cancel",
      showCode: "Show store code",
      hideCode: "Hide store code"
    };
  }

  return {
    subtitle: "เข้าสู่ระบบขาย",
    storeCodeLabel: "รหัสร้านค้า",
    storeCodePlaceholder: "กรอกรหัสร้านค้า",
    submit: "ล็อกอิน",
    submitting: "กำลังตรวจสอบ...",
    checking: "กำลังตรวจสอบข้อมูลร้านค้า...",
    checkingTitle: "กำลังตรวจสอบ",
    close: "ปิด",
    failedTitle: "เข้าสู่ระบบไม่สำเร็จ",
    requiredError: "กรุณากรอกรหัสร้านค้า",
    formatError: "รูปแบบรหัสร้านค้าไม่ถูกต้อง",
    notFoundError: "ไม่พบรหัสร้านค้านี้ หรือร้านค้ายังไม่เปิดใช้งาน",
    rateLimitError: "มีการลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
    verifyFailedError: "ไม่สามารถตรวจสอบรหัสร้านค้าได้ในขณะนี้",
    defaultError: "ไม่สามารถเข้าสู่ระบบได้ กรุณาตรวจสอบรหัสร้านค้า",
    timeoutError: "หมดเวลาการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง",
    networkError: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้",
    cancel: "ยกเลิก",
    showCode: "แสดงรหัสร้านค้า",
    hideCode: "ซ่อนรหัสร้านค้า"
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

function mapStoreErrorMessage(code: string | null | undefined, copy: ReturnType<typeof getCopy>) {
  if (code === "store_code_required") return copy.requiredError;
  if (code === "store_not_found") return copy.notFoundError;
  if (code === "rate_limited") return copy.rateLimitError;
  if (code === "auth_timeout") return copy.timeoutError;
  if (code === "store_verify_failed") return copy.verifyFailedError;
  return copy.defaultError;
}

function normalizeStoreCodeInput(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

function isStoreCodeFormatValid(storeCode: string) {
  return /^[A-Z0-9_-]{3,32}$/.test(storeCode);
}

function isRetryableRequestError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return error instanceof TypeError;
}

function mapNetworkErrorMessage(error: unknown, copy: ReturnType<typeof getCopy>) {
  if (error instanceof DOMException && error.name === "AbortError") return copy.timeoutError;
  return copy.networkError;
}

async function requestStoreVerification(storeCode: string, controller: AbortController): Promise<VerifyRequestResult> {
  const timeoutId = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("/api/auth/store-code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_code: storeCode }),
      signal: controller.signal
    });
    const body = (await response.json().catch(() => null)) as StoreVerifyResponse | null;
    return { response, body };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function verifyStoreCodeWithRetry(storeCode: string, controller: AbortController) {
  const attempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestStoreVerification(storeCode, controller);
    } catch (error) {
      lastError = error;
      if (!isRetryableRequestError(error) || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250 * attempt));
    }
  }

  throw lastError;
}

export default function LoginStorePage() {
  const router = useRouter();
  const { lang, setLanguage } = useAppLanguage("th");
  const copy = useMemo(() => getCopy(lang), [lang]);
  const [storeCode, setStoreCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<PopupState>({ type: "none" });
  const [showStoreCode, setShowStoreCode] = useState(false);
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/pos/session/current", { cache: "no-store" })
      .then((response) => {
        if (active && response.ok) router.replace("/preview/pos");
      })
      .catch(() => {
        // No active POS session; keep the store-code form visible.
      });

    clearPreEntryClientCache();
    warmRoute(router, "/login/branches?flow=multi");
    warmRoute(router, "/login/employee?flow=single");

    return () => {
      active = false;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const normalizedStoreCode = storeCode.trim().toUpperCase();
    if (!normalizedStoreCode) {
      setError(copy.requiredError);
      setPopup({ type: "error", message: copy.requiredError });
      return;
    }
    if (!isStoreCodeFormatValid(normalizedStoreCode)) {
      setError(copy.formatError);
      setPopup({ type: "error", message: copy.formatError });
      return;
    }

    setLoading(true);
    setError("");
    setPopup({ type: "loading", message: copy.checking });

    let navigateTo: string | null = null;
    let hasFailure = false;
    const controller = new AbortController();
    activeControllerRef.current = controller;

    try {
      const { response, body } = await verifyStoreCodeWithRetry(normalizedStoreCode, controller);
      if (!response.ok || !body?.data) {
        const message = mapStoreErrorMessage(body?.error?.code, copy);
        setError(message);
        setPopup({ type: "error", message });
        hasFailure = true;
        return;
      }

      const flowMode = body.data.next_step === "employee" ? "single" : "multi";
      navigateTo = body.data.next_step === "employee" ? `/login/employee?flow=${flowMode}` : `/login/branches?flow=${flowMode}`;
      cacheBranches(body.data.branches ?? []);
      warmRoute(router, navigateTo);
    } catch (requestError) {
      if (controller.signal.aborted && activeControllerRef.current === null) {
        hasFailure = true;
        return;
      }
      const message = mapNetworkErrorMessage(requestError, copy);
      setError(message);
      setPopup({ type: "error", message });
      hasFailure = true;
    } finally {
      activeControllerRef.current = null;
      setLoading(false);
      if (navigateTo) {
        setPopup({ type: "none" });
        router.push(navigateTo);
      } else if (!hasFailure) {
        setPopup({ type: "none" });
      }
    }
  }

  function cancelLoading() {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setLoading(false);
    setPopup({ type: "none" });
  }

  return (
    <main className="store-v2-page">
      <section className="store-v2-card">
        <div className="store-v2-topbar">
          <AppLanguageSwitcher lang={lang} onChange={setLanguage} />
        </div>

        <div className="store-v2-logo-wrap">
          <Image
            src="/brand/cpipos-logo.png"
            alt="CpIPOS Logo"
            className="store-v2-logo"
            width={1448}
            height={1086}
            style={{ width: "220px", height: "165px", objectFit: "contain" }}
            priority
          />
        </div>

        <form className="store-v2-form" onSubmit={handleSubmit}>
          <label htmlFor="storeCode">{copy.storeCodeLabel}</label>

          <div className="store-v2-input-box store-v2-input-box-with-toggle">
            <span className="store-v2-input-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M4 10V20H20V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M3 10L5 4H19L21 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 20V14H16V20" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M3 10C3 11.3 4 12 5.2 12C6.4 12 7.2 11.3 7.2 10C7.2 11.3 8.2 12 9.4 12C10.6 12 11.4 11.3 11.4 10C11.4 11.3 12.4 12 13.6 12C14.8 12 15.6 11.3 15.6 10C15.6 11.3 16.6 12 17.8 12C19 12 21 11.3 21 10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>

            <span className="store-v2-input-line" />

            <input
              id="storeCode"
              type={showStoreCode ? "text" : "password"}
              value={storeCode}
              onChange={(event) => {
                setStoreCode(normalizeStoreCodeInput(event.target.value));
                if (error) setError("");
                if (popup.type === "error") setPopup({ type: "none" });
              }}
              placeholder={copy.storeCodePlaceholder}
              maxLength={32}
              spellCheck={false}
              inputMode="text"
              aria-invalid={Boolean(error)}
              aria-describedby="storeCodeHelp"
              autoComplete="off"
            />
            <button
              type="button"
              className="login-code-visibility-btn"
              onClick={() => setShowStoreCode((current) => !current)}
              aria-label={showStoreCode ? copy.hideCode : copy.showCode}
              title={showStoreCode ? copy.hideCode : copy.showCode}
            >
              <EyeIcon open={showStoreCode} />
            </button>
          </div>
          <div id="storeCodeHelp" className="store-v2-field-meta">
            <span>{storeCode.length}/32</span>
          </div>

          <button type="submit" className="store-v2-login-btn" disabled={loading || !storeCode.trim()}>
            {loading ? copy.submitting : copy.submit}
          </button>
          {error ? (
            <p className="store-v2-error" role="alert" aria-live="assertive">
              {error}
            </p>
          ) : null}
        </form>
      </section>

      {popup.type !== "none" ? (
        <div className="store-v2-popup-overlay" role="dialog" aria-modal="true" aria-live="polite">
          <div className="store-v2-popup-card">
            {popup.type === "loading" ? (
              <>
                <div className="store-v2-popup-spinner" aria-hidden="true" />
                <p className="store-v2-popup-title">{copy.checkingTitle}</p>
                <p className="store-v2-popup-text">{popup.message}</p>
                <button type="button" className="store-v2-popup-close-btn" onClick={cancelLoading}>
                  {copy.cancel}
                </button>
              </>
            ) : (
              <>
                <div className="store-v2-popup-error-icon" aria-hidden="true">
                  !
                </div>
                <p className="store-v2-popup-title">{copy.failedTitle}</p>
                <p className="store-v2-popup-text">{popup.message}</p>
                <button type="button" className="store-v2-popup-close-btn" onClick={() => setPopup({ type: "none" })}>
                  {copy.close}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

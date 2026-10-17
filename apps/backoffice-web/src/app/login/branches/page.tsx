"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PreEntryShell } from "@/components/pre-entry/pre-entry-shell";
import { AppLanguageSwitcher } from "@/components/i18n/app-language-switcher";
import { useAppLanguage, type AppLanguage } from "@/lib/app-language-client";
import { loginFlowText } from "@/lib/pre-entry-language";
import {
  cacheBranches,
  cacheSelectedBranch,
  clearPreEntryClientCache,
  readCachedBranches,
  warmRoute
} from "@/lib/pre-entry-client-cache";

type Branch = {
  id: string;
  code: string | null;
  name: string | null;
  address: string | null;
};

type BranchesResponse = {
  data?: {
    selected_branch_id: string | null;
    branches: Branch[];
  } | null;
  error?: { code: string; message: string } | null;
};

type SelectBranchResponse = {
  data?: { next_step: "employee" } | null;
  error?: { code: string; message: string } | null;
};

type PopupState =
  | { type: "none" }
  | { type: "loading"; message: string }
  | { type: "error"; message: string };

const AUTH_REQUEST_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 20000 : 15000;

function isRetryableRequestError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof TypeError;
}

function mapNetworkErrorMessage(error: unknown, lang: AppLanguage) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return loginFlowText(lang, "หมดเวลาการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง");
  }
  return loginFlowText(lang, "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
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

async function fetchJsonWithRetry<T>(input: RequestInfo | URL, init?: RequestInit) {
  const attempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init);
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

function LoginBranchesPageContent() {
  const router = useRouter();
  const {lang,setLanguage}=useAppLanguage("th");
  const T=useCallback((value:string)=>loginFlowText(lang,value),[lang]);
  const searchParams = useSearchParams();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<PopupState>({ type: "none" });
  const employeeCode = (searchParams.get("employee_code") ?? searchParams.get("employee_name") ?? "").trim();
  const employeeQuery = employeeCode ? `&employee_code=${encodeURIComponent(employeeCode)}` : "";

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const cached = readCachedBranches();
      if (cached?.branches.length) {
        const uniqueBranches = cached.branches.filter(
          (branch, index, items) => Boolean(branch?.id) && items.findIndex((item) => item.id === branch.id) === index
        );
        setBranches(uniqueBranches);
        setSelectedBranchId(
          uniqueBranches.some((branch) => branch.id === cached.selectedBranchId)
            ? (cached.selectedBranchId ?? "")
            : (uniqueBranches[0]?.id ?? "")
        );
        setLoading(false);
        warmRoute(router, `/login/employee?flow=${uniqueBranches.length === 1 ? "single" : "multi"}${employeeQuery}`);
        return;
      }

      try {
        const { response, body } = await fetchJsonWithRetry<BranchesResponse>("/api/auth/branches");
        if (!response.ok || !body?.data) {
          if (mounted) {
            router.replace("/login/store");
          }
          return;
        }

        const uniqueBranches = (body.data.branches ?? []).filter((branch, index, arr) => {
          if (!branch?.id) return false;
          return arr.findIndex((item) => item.id === branch.id) === index;
        });

        if (uniqueBranches.length === 0) {
          if (mounted) {
            setError(T("ไม่พบรายการสาขาที่ใช้งานได้"));
            setPopup({ type: "error", message: T("ไม่พบรายการสาขาที่ใช้งานได้") });
          }
          return;
        }

        if (uniqueBranches.length === 1) {
          setBranches(uniqueBranches);
          setSelectedBranchId(uniqueBranches[0].id);
          return;
        }

        if (mounted) {
          cacheBranches(uniqueBranches, body.data.selected_branch_id);
          setBranches(uniqueBranches);
          const selected = uniqueBranches.some((branch) => branch.id === body.data?.selected_branch_id)
            ? (body.data?.selected_branch_id ?? "")
            : (uniqueBranches[0]?.id ?? "");
          setSelectedBranchId(selected);
        }
      } catch (requestError) {
        if (mounted) {
          const message = mapNetworkErrorMessage(requestError,lang);
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
  }, [employeeQuery, router, lang, T]);

  async function handleSelect() {
    if (submitting || loading) return;

    if (!selectedBranchId) {
      const message = T("กรุณาเลือกสาขา");
      setError(message);
      setPopup({ type: "error", message });
      return;
    }

    const selectedExists = branches.some((branch) => branch.id === selectedBranchId);
    if (!selectedExists) {
      const message = T("สาขาที่เลือกไม่ถูกต้อง กรุณาเลือกใหม่");
      setError(message);
      setPopup({ type: "error", message });
      return;
    }

    setSubmitting(true);
    setError("");
    setPopup({ type: "loading", message: T("กำลังเข้าสู่ระบบ...") });
    let hasFailure = false;
    let shouldNavigate = false;
    try {
      const { response, body } = await fetchJsonWithRetry<SelectBranchResponse>("/api/auth/branches/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: selectedBranchId })
      });
      if (!response.ok || !body?.data || body.data.next_step !== "employee") {
        const message = T("ไม่สามารถเลือกสาขาได้");
        setError(message);
        setPopup({ type: "error", message });
        hasFailure = true;
        return;
      }
      shouldNavigate = true;
      const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);
      if (selectedBranch) cacheSelectedBranch(selectedBranch);
      warmRoute(router, `/login/employee?flow=multi${employeeQuery}`);
    } catch (requestError) {
      const message = mapNetworkErrorMessage(requestError,lang);
      setError(message);
      setPopup({ type: "error", message });
      hasFailure = true;
    } finally {
      setSubmitting(false);
      if (shouldNavigate) {
        setPopup({ type: "none" });
        router.push(`/login/employee?flow=multi${employeeQuery}`);
      } else if (!hasFailure) {
        setPopup({ type: "none" });
      }
    }
  }

  async function handleLogout() {
    await fetchWithTimeout("/api/auth/session/context", { method: "DELETE" }, 5000).catch(() => null);
    clearPreEntryClientCache();
    router.replace("/login/store");
  }

  return (
    <PreEntryShell mode="multi" activeStep={2} title="" layout="store" showModePill={false} showStepbar={false}>
      <div className="store-v2-topbar"><AppLanguageSwitcher lang={lang} onChange={setLanguage} /></div>
      {loading ? <p className="ipos-loading-text">{T("กำลังโหลดรายการสาขา...")}</p> : null}

      {!loading ? (
        <div className="ipos-branch-selector-card">
          <h3 className="ipos-branch-selector-title">{T("เลือกสาขา")}</h3>
          <div className="ipos-branch-list ipos-branch-list-compact">
            {branches.map((branch) => {
              const branchCode = branch.code?.trim() || "";
              const branchName = branch.name?.trim() || branchCode || branch.id;
              const showBranchCode = Boolean(branchCode && branchCode !== branchName);

              return (
                <button
                  key={branch.id}
                  type="button"
                  className={`ipos-branch-card ipos-branch-card-compact ${selectedBranchId === branch.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedBranchId(branch.id);
                    if (error) setError("");
                    if (popup.type === "error") setPopup({ type: "none" });
                  }}
                >
                  <div className="ipos-branch-row-left">
                    <span className="ipos-icon-box ipos-icon-box-branch" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M4 20h16M6 20V7l6-3 6 3v13M9 10h2M9 13h2M9 16h2M13 10h2M13 13h2M13 16h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="ipos-branch-text">
                      <span className="ipos-branch-name">{branchName}</span>
                      {showBranchCode ? <span className="ipos-branch-code">{T("รหัสสาขา")}: {branchCode}</span> : null}
                    </span>
                  </div>
                  <span className={`ipos-select-dot ${selectedBranchId === branch.id ? "active" : ""}`} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? <p className="ipos-error">{error}</p> : null}
      <div className="ipos-inline-actions ipos-branch-actions">
        <button type="button" className="ipos-outline-btn ipos-btn-compact-secondary" onClick={handleLogout}>
          {T("ออกจากระบบ")}
        </button>
        <button type="button" className="ipos-primary-btn ipos-btn-compact" onClick={handleSelect} disabled={submitting || loading}>
          {submitting ? T("กำลังบันทึก...") : T("ถัดไป")}
        </button>
      </div>

      {popup.type !== "none" ? (
        <div className="store-v2-popup-overlay" role="dialog" aria-modal="true" aria-live="polite">
          <div className="store-v2-popup-card">
            {popup.type === "loading" ? (
              <>
                <div className="store-v2-popup-spinner" aria-hidden="true" />
                <p className="store-v2-popup-title">{T("กำลังเข้าสู่ระบบ")}</p>
                <p className="store-v2-popup-text">{popup.message}</p>
              </>
            ) : (
              <>
                <div className="store-v2-popup-error-icon" aria-hidden="true">
                  !
                </div>
                <p className="store-v2-popup-title">{T("ดำเนินการไม่สำเร็จ")}</p>
                <p className="store-v2-popup-text">{popup.message}</p>
                <button type="button" className="store-v2-popup-close-btn" onClick={() => setPopup({ type: "none" })}>
                  {T("ปิด")}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </PreEntryShell>
  );
}

export default function LoginBranchesPage() {
  return (
    <Suspense
      fallback={
        <PreEntryShell mode="multi" activeStep={2} title="" layout="store" showModePill={false} showStepbar={false}>
          <p className="ipos-loading-text">กำลังโหลดรายการสาขา...</p>
        </PreEntryShell>
      }
    >
      <LoginBranchesPageContent />
    </Suspense>
  );
}




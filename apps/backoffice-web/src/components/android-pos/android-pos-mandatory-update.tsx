"use client";

import { useCallback, useEffect, useState } from "react";
import { shouldDisableNativeCustomerDisplayForDiagnostics } from "@/lib/android-pos/native-device-policy";
import { shouldShowAndroidTabletUpdateNotice } from "@/lib/android-pos/update-notice-client";
import { ANDROID_MODERN_RELEASE } from "@/lib/android-runtime-release";
import { isLocallyIdle, isSafeForAppUpdate, isTrustedAndroidDownload } from "@/lib/app-update-safety";

type NativeDiagnostics = {
  install_id?: unknown;
  app?: {
    version_code?: unknown;
    version_name?: unknown;
  };
};

type EnforcementResponse = {
  required?: boolean;
  target_version_name?: string;
  target_version_code?: number;
  download_url?: string;
};

type CpiposMdmBridge = {
  diagnosticsJson?: () => string;
};

declare global {
  interface Window {
    CpiposMdm?: CpiposMdmBridge;
  }
}

const FALLBACK_DOWNLOAD_URL = "/download/android/modern-latest";
const POLL_MS = 10 * 60_000;
const CUSTOMER_DISPLAY_V2_ENABLED_KEY = "pos_customer_display_v2_enabled_v001";


export function AndroidPosMandatoryUpdate() {
  const [required, setRequired] = useState(false);
  const [checking, setChecking] = useState(false);
  const [targetName, setTargetName] = useState<string>(ANDROID_MODERN_RELEASE.versionName);
  const [targetCode, setTargetCode] = useState<number>(ANDROID_MODERN_RELEASE.versionCode);
  const [downloadUrl, setDownloadUrl] = useState(FALLBACK_DOWNLOAD_URL);
  const [rollbackMode, setRollbackMode] = useState(false);
  const [safeToUpdate, setSafeToUpdate] = useState(false);
  const [downloadConfirmed, setDownloadConfirmed] = useState(false);

  const check = useCallback(async () => {
    if (!shouldShowAndroidTabletUpdateNotice()) return;
    const bridge = window.CpiposMdm;
    if (!bridge?.diagnosticsJson) {
      setRequired(false);
      return;
    }

    let diagnostics: NativeDiagnostics;
    try {
      diagnostics = JSON.parse(bridge.diagnosticsJson()) as NativeDiagnostics;
    } catch {
      return;
    }

    const installId = String(diagnostics.install_id ?? "").trim();
    const versionCode = Number(diagnostics.app?.version_code ?? 0);
    if (!installId || !Number.isFinite(versionCode) || versionCode <= 0) return;
    if (shouldDisableNativeCustomerDisplayForDiagnostics(diagnostics)) {
      window.localStorage.setItem(CUSTOMER_DISPLAY_V2_ENABLED_KEY, "0");
    }

    setRollbackMode(false);
    setChecking(true);
    try {
      const response = await fetch("/api/android-pos/update-enforcement", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ install_id: installId, version_code: versionCode })
      });
      const data = (await response.json().catch(() => null)) as EnforcementResponse | null;
      if (!response.ok || !data) return;

      setRequired(data.required === true);
      if (data.target_version_name) setTargetName(data.target_version_name);
      if (Number.isFinite(Number(data.target_version_code))) setTargetCode(Number(data.target_version_code));
      if (data.download_url && isTrustedAndroidDownload(data.download_url, window.location.origin)) {
        setDownloadUrl(data.download_url);
      } else {
        setDownloadUrl(FALLBACK_DOWNLOAD_URL);
      }
    } catch {
      // Offline or temporary server failure must not interrupt sales.
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!shouldShowAndroidTabletUpdateNotice()) return;
    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    const onWake = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [check]);

  useEffect(() => {
    if (!required) return;
    let disposed = false;
    const refresh = async () => {
      const safe = await isSafeForAppUpdate();
      if (!disposed) {
        setSafeToUpdate(safe);
        if (!safe) setDownloadConfirmed(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [required]);

  if (!required || !shouldShowAndroidTabletUpdateNotice()) return null;

  // Let the operator finish and reconcile an in-flight sale before enforcing the APK update.
  if (!safeToUpdate) {
    return (
      <div role="status" style={{ position: "fixed", right: 16, top: 16, zIndex: 10000, maxWidth: 340, padding: 12, borderRadius: 10, background: "#fff7ed", color: "#9a3412", boxShadow: "0 4px 16px #0002", pointerEvents: "none" }}>
        ต้องอัปเดต CpIPOS {targetName} กรุณาปิดงานขาย ซิงก์ข้อมูลค้าง และกลับหน้าเข้าสู่ระบบเพื่อดาวน์โหลด
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal={rollbackMode ? undefined : true}
      aria-label={rollbackMode ? "CpIPOS Android rollback available" : "CpIPOS Android update required"}
      style={rollbackMode
        ? {
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 2147483647,
            width: "min(420px, calc(100vw - 32px))",
            pointerEvents: "none"
          }
        : {
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "rgba(2, 6, 23, 0.78)",
            backdropFilter: "blur(8px)"
          }}
    >
      <div
        style={{
          width: rollbackMode ? "100%" : "min(520px, 100%)",
          borderRadius: rollbackMode ? 18 : 24,
          background: "#ffffff",
          padding: rollbackMode ? 18 : 28,
          boxShadow: "0 28px 90px rgba(0,0,0,.35)",
          color: "#0f172a",
          fontFamily: "Tahoma, Arial, sans-serif",
          pointerEvents: "auto"
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: rollbackMode ? "#b45309" : "#2563eb", letterSpacing: ".08em" }}>
          {rollbackMode ? "CPIPOS RECOVERY" : "CPIPOS SYSTEM UPDATE"}
        </div>
        <h2 style={{ margin: "10px 0 8px", fontSize: rollbackMode ? 20 : 26, lineHeight: 1.25 }}>
          {rollbackMode ? "มีเวอร์ชันเดิมสำหรับกู้การใช้งานเครื่องนี้" : "ต้องอัปเดต CpIPOS ก่อนใช้งานต่อ"}
        </h2>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.65, fontSize: rollbackMode ? 13 : 15 }}>
          {rollbackMode
            ? `สามารถใช้งาน POS ต่อได้ระหว่างนี้ หรือดาวน์โหลด CpIPOS ${targetName} (code ${targetCode}) รุ่นเดิมสำหรับเครื่องนี้เท่านั้น`
            : `กรุณาอัปเดตแอปเป็นเวอร์ชัน ${targetName} (code ${targetCode}) รุ่นล่าสุด ระบบจะแสดงหน้าต่างนี้ซ้ำจนกว่าจะติดตั้งสำเร็จ`}
        </p>

        {!rollbackMode ? (
          <div style={{ marginTop: 18, borderRadius: 14, background: "#eff6ff", padding: 14, color: "#1e3a8a", lineHeight: 1.65 }}>
            1. กด “ตรวจสอบก่อนดาวน์โหลด” แล้วกดลิงก์ดาวน์โหลด APK<br />
            2. เปิดไฟล์ APK ที่ดาวน์โหลดและยืนยันติดตั้งทับแอปเดิม (ไม่ถอนการติดตั้ง)<br />
            3. เปิด CpIPOS อีกครั้ง ระบบจะตรวจ code {targetCode} อัตโนมัติ
          </div>
        ) : null}

        {downloadConfirmed ? (
          <a
            href={downloadUrl}
            onClick={(event) => {
              // A genuine link gesture is required by the hardened Android WebView.
              try {
                if (safeToUpdate && isLocallyIdle() && isTrustedAndroidDownload(downloadUrl, window.location.origin)) return;
              } catch {
                // Do not download if local state cannot be read.
              }
              event.preventDefault();
              setDownloadConfirmed(false);
              setSafeToUpdate(false);
            }}
            style={{ display: "block", textAlign: "center", marginTop: 16, borderRadius: 12, padding: "14px 18px", background: "#2563eb", color: "#fff", fontWeight: 800 }}
          >
            ดาวน์โหลด APK ที่ตรวจสอบแล้ว {targetName}
          </a>
        ) : (
        <button
          type="button"
          onClick={async () => {
            if (!(await isSafeForAppUpdate())) { setSafeToUpdate(false); return; }
            setDownloadConfirmed(isTrustedAndroidDownload(downloadUrl, window.location.origin));
          }}
          style={{
            width: "100%",
            marginTop: 16,
            border: 0,
            borderRadius: 12,
            padding: rollbackMode ? "11px 14px" : "14px 18px",
            background: rollbackMode ? "#b45309" : "#2563eb",
            color: "#ffffff",
            fontSize: rollbackMode ? 14 : 17,
            fontWeight: 800,
            cursor: "pointer"
          }}
        >
          {rollbackMode ? `ตรวจสอบก่อนดาวน์โหลด code ${targetCode}` : `ตรวจสอบก่อนดาวน์โหลด ${targetName}`}
        </button>
        )}

        {!rollbackMode ? (
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            style={{
              width: "100%",
              marginTop: 10,
              border: "1px solid #cbd5e1",
              borderRadius: 14,
              padding: "12px 18px",
              background: "#ffffff",
              color: "#334155",
              fontSize: 15,
              fontWeight: 700,
              cursor: checking ? "wait" : "pointer"
            }}
          >
            {checking ? "กำลังตรวจสอบ..." : "ตรวจสอบหลังติดตั้งอีกครั้ง"}
          </button>
        ) : null}

        <p style={{ margin: "10px 0 0", textAlign: "center", color: "#94a3b8", fontSize: 11 }}>
          {rollbackMode
            ? "กล่องนี้ไม่บล็อกการใช้งาน POS และมีผลเฉพาะเครื่องนี้"
            : `หน้าต่างนี้จะหายอัตโนมัติเมื่อ CpIPOS รายงาน versionCode ${targetCode}`}
        </p>
      </div>
    </div>
  );
}

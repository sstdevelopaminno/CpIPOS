"use client";

import { useCallback, useEffect, useState } from "react";

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
const POLL_MS = 15_000;

export function AndroidPosMandatoryUpdate() {
  const [required, setRequired] = useState(false);
  const [checking, setChecking] = useState(false);
  const [targetName, setTargetName] = useState("1.0.20");
  const [targetCode, setTargetCode] = useState(28);
  const [downloadUrl, setDownloadUrl] = useState(FALLBACK_DOWNLOAD_URL);

  const check = useCallback(async () => {
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
      if (data.download_url) setDownloadUrl(data.download_url);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [check]);

  if (!required) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="CpIPOS Android update required"
      style={{
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
          width: "min(520px, 100%)",
          borderRadius: 24,
          background: "#ffffff",
          padding: 28,
          boxShadow: "0 28px 90px rgba(0,0,0,.35)",
          color: "#0f172a",
          fontFamily: "Tahoma, Arial, sans-serif"
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: "#2563eb", letterSpacing: ".08em" }}>
          CPIPOS SYSTEM UPDATE
        </div>
        <h2 style={{ margin: "10px 0 8px", fontSize: 26, lineHeight: 1.25 }}>
          ต้องอัปเดต CpIPOS ก่อนใช้งานต่อ
        </h2>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>
          กรุณาอัปเดตแอปเป็นเวอร์ชัน {targetName} (code {targetCode}) รุ่นล่าสุด ระบบจะแสดงหน้าต่างนี้ซ้ำจนกว่าจะติดตั้งสำเร็จ
        </p>

        <div style={{ marginTop: 18, borderRadius: 14, background: "#eff6ff", padding: 14, color: "#1e3a8a", lineHeight: 1.65 }}>
          1. กด “ดาวน์โหลดและติดตั้ง”<br />
          2. เปิดไฟล์ APK ที่ดาวน์โหลดและยืนยันติดตั้ง<br />
          3. เปิด CpIPOS อีกครั้ง ระบบจะตรวจ code {targetCode} อัตโนมัติ
        </div>

        <button
          type="button"
          onClick={() => window.location.assign(downloadUrl)}
          style={{
            width: "100%",
            marginTop: 20,
            border: 0,
            borderRadius: 14,
            padding: "14px 18px",
            background: "#2563eb",
            color: "#ffffff",
            fontSize: 17,
            fontWeight: 800,
            cursor: "pointer"
          }}
        >
          ดาวน์โหลดและติดตั้ง {targetName}
        </button>

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

        <p style={{ margin: "14px 0 0", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          หน้าต่างนี้ไม่มีปุ่มปิดและจะหายอัตโนมัติเมื่อ CpIPOS รายงาน versionCode {targetCode}
        </p>
      </div>
    </div>
  );
}

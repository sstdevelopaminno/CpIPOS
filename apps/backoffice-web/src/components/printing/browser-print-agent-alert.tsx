"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const BROWSER_PRINT_AGENT_STATUS_EVENT = "cpi-browser-print-agent-status";
const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
const POS_PATH_PREFIX = "/preview/pos";

type BrowserPrintAgentStatus = {
  enabled: boolean;
  supported: boolean;
  connected: boolean;
  code: string;
  message: string;
  jobsPrinted: number;
  lastJobId: string | null;
  updatedAt: string;
};

type AlertCopy = {
  title: string;
  detail: string;
  actionHint: string;
  severity: "warning" | "danger";
};

const OK_STATUS_CODES = new Set(["ready", "printed", "reset"]);
const PROBLEM_STATUS_CODES = new Set([
  "disabled",
  "web_serial_unsupported",
  "agent_key_missing",
  "serial_permission_required",
  "agent_error",
  "print_failed",
  "browser_serial_print_failed",
  "serial_port_not_writable",
  "paper_out",
  "cover_open",
  "paper_jam",
  "printer_offline"
]);

function isPosPath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith(POS_PATH_PREFIX);
}

function copyForStatus(status: BrowserPrintAgentStatus): AlertCopy {
  if (status.code === "paper_out") {
    return {
      title: "เครื่องพิมพ์กระดาษหมด",
      detail: "ระบบตรวจพบสถานะกระดาษหมดจากเครื่องพิมพ์ กรุณาใส่กระดาษใหม่แล้วลองพิมพ์อีกครั้ง",
      actionHint: "ตรวจสอบม้วนกระดาษและปิดฝาเครื่องให้สนิท",
      severity: "danger"
    };
  }
  if (status.code === "cover_open") {
    return {
      title: "ฝาเครื่องพิมพ์เปิดอยู่",
      detail: "ระบบตรวจพบว่าฝาเครื่องพิมพ์ยังไม่ปิด จึงอาจพิมพ์ใบเสร็จไม่ได้",
      actionHint: "ปิดฝาเครื่องพิมพ์ แล้วลองพิมพ์อีกครั้ง",
      severity: "danger"
    };
  }
  if (status.code === "paper_jam") {
    return {
      title: "เครื่องพิมพ์อาจมีกระดาษติด",
      detail: "ระบบตรวจพบปัญหาระหว่างพิมพ์ อาจเกิดจากกระดาษติด หัวพิมพ์ หรือ cutter ค้าง",
      actionHint: "ตรวจสอบกระดาษ หัวพิมพ์ และช่องทางออกกระดาษ",
      severity: "danger"
    };
  }
  if (status.code === "disabled") {
    return {
      title: "ยังไม่ได้เปิด Browser Print Agent",
      detail: "ระบบพิมพ์อัตโนมัติยังปิดอยู่ ใบเสร็จอาจไม่ออกจากเครื่องพิมพ์จนกว่าจะเปิด Agent",
      actionHint: "เปิด Browser Print Agent ในหน้าตั้งค่าเครื่องพิมพ์ก่อนใช้งานจริง",
      severity: "warning"
    };
  }
  if (status.code === "web_serial_unsupported") {
    return {
      title: "เบราว์เซอร์นี้ไม่รองรับ Web Serial",
      detail: "ระบบไม่สามารถเชื่อมต่อเครื่องพิมพ์ผ่าน Browser Print Agent ได้จากเบราว์เซอร์นี้",
      actionHint: "แนะนำใช้ Chrome หรือ Edge บนเครื่องที่ต่อเครื่องพิมพ์",
      severity: "danger"
    };
  }
  if (status.code === "agent_key_missing") {
    return {
      title: "ยังไม่ได้ตั้งค่า Print Agent Secret",
      detail: "Browser Print Agent ยังไม่มีรหัสเชื่อมต่อ จึงรับงานพิมพ์จากระบบไม่ได้",
      actionHint: "ตั้งค่า Agent Secret ให้ตรงกับระบบหลังบ้าน",
      severity: "warning"
    };
  }
  if (status.code === "serial_permission_required") {
    return {
      title: "ยังไม่ได้เลือกพอร์ตเครื่องพิมพ์",
      detail: "ระบบยังไม่ได้รับสิทธิ์เข้าถึงพอร์ตเครื่องพิมพ์ หรือเครื่องพิมพ์หลุดจากเครื่องนี้",
      actionHint: "เลือกพอร์ตเครื่องพิมพ์ใหม่ แล้วตรวจสอบสาย USB/Bluetooth/Serial",
      severity: "warning"
    };
  }
  if (status.code === "serial_port_not_writable" || status.code === "printer_offline") {
    return {
      title: "เครื่องพิมพ์ไม่พร้อมใช้งาน",
      detail: "ระบบเชื่อมต่อพอร์ตได้แต่ไม่สามารถส่งข้อมูลเข้าเครื่องพิมพ์ได้",
      actionHint: "ตรวจสอบสายเชื่อมต่อ ไฟเครื่องพิมพ์ กระดาษ และลองเปิดเครื่องใหม่",
      severity: "danger"
    };
  }
  if (status.code === "browser_serial_print_failed" || status.code === "print_failed") {
    return {
      title: "พิมพ์ใบเสร็จไม่สำเร็จ",
      detail: "ระบบส่งงานพิมพ์ไม่สำเร็จ อาจเกิดจากกระดาษหมด กระดาษติด เครื่องหลุด หรือเครื่องไม่ตอบสนอง",
      actionHint: "ตรวจสอบกระดาษ ฝาเครื่อง สายเชื่อมต่อ แล้วลองพิมพ์ซ้ำจากใบเสร็จ",
      severity: "danger"
    };
  }
  return {
    title: "เครื่องพิมพ์มีปัญหา",
    detail: status.message || "ระบบตรวจพบปัญหาจาก Browser Print Agent",
    actionHint: "ตรวจสอบกระดาษ ฝาเครื่อง สายเชื่อมต่อ และสถานะ Browser Print Agent",
    severity: "warning"
  };
}

function shouldShowStatus(status: BrowserPrintAgentStatus) {
  if (!isPosPath()) return false;
  if (OK_STATUS_CODES.has(status.code)) return false;
  if (PROBLEM_STATUS_CODES.has(status.code)) return true;
  if (status.enabled && status.supported && !status.connected) return true;
  return false;
}

export function BrowserPrintAgentAlert() {
  const [status, setStatus] = useState<BrowserPrintAgentStatus | null>(null);
  const dismissedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    function handleStatus(event: Event) {
      const detail = (event as CustomEvent<BrowserPrintAgentStatus>).detail;
      if (!detail || typeof detail.code !== "string") return;

      if (!shouldShowStatus(detail)) {
        setStatus(null);
        return;
      }

      const signature = `${detail.code}:${detail.lastJobId ?? "none"}`;
      if (dismissedSignatureRef.current === signature) return;
      setStatus(detail);
    }

    window.addEventListener(BROWSER_PRINT_AGENT_STATUS_EVENT, handleStatus);
    return () => window.removeEventListener(BROWSER_PRINT_AGENT_STATUS_EVENT, handleStatus);
  }, []);

  const copy = useMemo(() => (status ? copyForStatus(status) : null), [status]);

  if (!status || !copy) return null;

  const signature = `${status.code}:${status.lastJobId ?? "none"}`;
  const borderColor = copy.severity === "danger" ? "#dc2626" : "#f59e0b";
  const badgeBg = copy.severity === "danger" ? "#fee2e2" : "#fef3c7";
  const badgeText = copy.severity === "danger" ? "#991b1b" : "#92400e";

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={copy.title}
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 2147483647,
        width: "min(420px, calc(100vw - 32px))",
        border: `2px solid ${borderColor}`,
        borderRadius: 18,
        background: "#ffffff",
        boxShadow: "0 22px 70px rgba(15, 23, 42, 0.28)",
        color: "#0f172a",
        overflow: "hidden",
        fontFamily: "Tahoma, 'Noto Sans Thai', system-ui, sans-serif"
      }}
    >
      <div style={{ padding: "16px 18px 14px", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                display: "inline-flex",
                width: "fit-content",
                borderRadius: 999,
                padding: "4px 10px",
                background: badgeBg,
                color: badgeText,
                fontSize: 12,
                fontWeight: 900
              }}
            >
              แจ้งเตือนเครื่องพิมพ์
            </span>
            <strong style={{ fontSize: 18, lineHeight: 1.2 }}>{copy.title}</strong>
          </div>
          <button
            type="button"
            aria-label="ปิดแจ้งเตือนเครื่องพิมพ์"
            onClick={() => {
              dismissedSignatureRef.current = signature;
              setStatus(null);
            }}
            style={{
              border: 0,
              background: "#f1f5f9",
              color: "#334155",
              width: 34,
              height: 34,
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 900,
              cursor: "pointer",
              lineHeight: "30px"
            }}
          >
            ×
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#334155", fontWeight: 700 }}>{copy.detail}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "#475569" }}>{copy.actionHint}</p>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_RESET_EVENT))}
            style={{
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#0f172a",
              borderRadius: 12,
              padding: "9px 12px",
              fontWeight: 900,
              cursor: "pointer"
            }}
          >
            รีเซ็ต Agent
          </button>
          <button
            type="button"
            onClick={() => {
              dismissedSignatureRef.current = signature;
              setStatus(null);
            }}
            style={{
              border: 0,
              background: "#0f172a",
              color: "#ffffff",
              borderRadius: 12,
              padding: "9px 12px",
              fontWeight: 900,
              cursor: "pointer"
            }}
          >
            รับทราบ
          </button>
        </div>
      </div>
    </div>
  );
}

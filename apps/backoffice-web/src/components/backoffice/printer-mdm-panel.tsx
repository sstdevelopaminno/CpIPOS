"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./printer-mdm-panel.module.css";

type NativePrinter = {
  configured_host: string | null;
  configured_port: number | null;
  last_reachable: boolean | null;
  last_error: string | null;
  last_command_action: string | null;
  last_command_source: string | null;
  last_command_at_ms: number | null;
};

type TestCommand = {
  id: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  result: Record<string, unknown> | null;
};

type MdmDevice = {
  id: string;
  device_code: string;
  device_name: string;
  device_type: string;
  status: string;
  is_active: boolean;
  last_seen_at: string | null;
  health_status: string | null;
  surface: string;
  runtime_version: string | null;
  app_version: string | null;
  native_printer: NativePrinter;
  latest_test_command: TestCommand | null;
};

type Envelope<T> = { data?: T; error?: { message?: string } };
type DeviceResponse = { devices: MdmDevice[] };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store"
  });
  const body = (await response.json().catch(() => ({}))) as Envelope<T> & T;
  if (!response.ok || body.error) throw new Error(body.error?.message ?? "ดำเนินการไม่สำเร็จ");
  return (body.data ?? body) as T;
}

function fmt(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}

function printerState(device: MdmDevice) {
  if (device.surface !== "android") return "ยังไม่พบ Android MDM bridge";
  if (!device.native_printer.configured_host) return "MDM พร้อม · ยังไม่ได้ตั้งค่า LAN printer ใน Android";
  if (device.native_printer.last_reachable === true) return "MDM พร้อม · เครื่องพิมพ์ตอบสนองล่าสุด";
  if (device.native_printer.last_reachable === false) return `MDM พร้อม · เครื่องพิมพ์ไม่ตอบสนอง${device.native_printer.last_error ? ` (${device.native_printer.last_error})` : ""}`;
  return `MDM พร้อม · ${device.native_printer.configured_host}:${device.native_printer.configured_port ?? 9100}`;
}

export function PrinterMdmPanel() {
  const [devices, setDevices] = useState<MdmDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api<DeviceResponse>("/api/backoffice/printers/mdm-devices");
      setDevices(data.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดสถานะ MDM ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function testPrinter(device: MdmDevice) {
    setBusy(device.id);
    setError(null);
    setNotice(null);
    try {
      await api("/api/backoffice/printers/mdm-devices", {
        method: "POST",
        body: JSON.stringify({ device_code: device.device_code })
      });
      setNotice(`ส่งคำสั่งทดสอบเครื่องพิมพ์ไปที่ ${device.device_name} (${device.device_code}) แล้ว รอ heartbeat ของเครื่อง POS ตอบกลับ`);
      await load();
      window.setTimeout(() => void load(), 4_000);
      window.setTimeout(() => void load(), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งคำสั่งทดสอบไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>เครื่อง POS ผ่าน MDM</h2>
          <p className={styles.subtitle}>เชื่อมสถานะ Android POS เข้ากับเมนูเครื่องพิมพ์ และส่งได้เฉพาะคำสั่งทดสอบการเชื่อมต่อเครื่องพิมพ์แบบปลอดภัยไปยังเครื่องที่เลือก</p>
        </div>
        <button className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "กำลังโหลด..." : "รีเฟรช MDM"}</button>
      </div>

      {notice ? <div className={styles.notice}>{notice}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.list}>
        {devices.map((device) => {
          const isAndroid = device.surface === "android";
          const online = device.status === "online" || device.health_status === "healthy";
          return (
            <div className={styles.device} key={device.id}>
              <div>
                <div className={styles.name}>{device.device_name}</div>
                <div className={styles.meta}>{device.device_code} · {device.device_type}</div>
              </div>
              <div>
                <span className={styles.status}><span className={`${styles.dot} ${online ? styles.online : styles.warn}`} />{online ? "ออนไลน์" : device.status}</span>
                <div className={styles.meta}>Heartbeat: {fmt(device.last_seen_at)}</div>
              </div>
              <div>
                <div className={isAndroid ? styles.native : styles.browser}>{isAndroid ? "Android MDM / CpiposMdm" : `Surface: ${device.surface}`}</div>
                <div className={styles.meta}>{printerState(device)}</div>
                {device.latest_test_command ? <div className={styles.meta}>ทดสอบล่าสุด: {device.latest_test_command.status} · {fmt(device.latest_test_command.issued_at)}</div> : null}
              </div>
              <button
                className={styles.test}
                onClick={() => void testPrinter(device)}
                disabled={!isAndroid || busy === device.id}
                title={isAndroid ? "ส่ง test_printer_connection ผ่าน MDM" : "ต้องเปิด POS ผ่าน Android MDM WebView ก่อน"}
              >
                {busy === device.id ? "กำลังส่ง..." : "ทดสอบเครื่องพิมพ์ผ่าน MDM"}
              </button>
            </div>
          );
        })}
        {!loading && devices.length === 0 ? <div className={styles.empty}>ยังไม่พบเครื่อง POS ที่ลงทะเบียนในสาขานี้</div> : null}
      </div>
    </section>
  );
}

"use client";

import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type PrinterRole = "receipt" | "kitchen" | "report";
type ConnectionType = "NETWORK_ESC_POS" | "STAR_WEBPRNT" | "LOCAL_BRIDGE" | "BLUETOOTH_BRIDGE";
type ActivePanel = "printers" | "agents" | "assignment";

type PrinterRow = {
  id: string;
  printer_name: string;
  printer_role: PrinterRole;
  connection_type: ConnectionType;
  ip_address: string | null;
  port: number | null;
  paper_width_mm: 58 | 80;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

type PrintAgentRow = {
  id: string;
  device_id: string | null;
  device_code: string;
  agent_name: string;
  status: "active" | "blocked" | "inactive";
  last_seen_at: string | null;
  last_claim_at: string | null;
  app_version: string | null;
  metadata: Record<string, unknown>;
};

type BluetoothDevice = { id: string; name: string; address: string | null; rssi: number | null; paired: boolean; connected: boolean };
type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };
type BridgeEnvelope<TData> = { ok: boolean; code: string; message: string; action: string; timestamp: string; data: TData };
type BridgeDebugEntry = { at: string; attempts: number; request: Record<string, unknown>; status: number | null; response: unknown };

const text = {
  title: "ตั้งค่าเครื่องพิมพ์",
  description: "ตั้งค่าเครื่องพิมพ์ใบเสร็จ ครัว รายงาน แอปพิมพ์ในเครื่อง Bluetooth Bridge และลิ้นชักเก็บเงิน",
  printers: "เครื่องพิมพ์",
  agents: "แอปพิมพ์",
  assignment: "การผูกเครื่อง",
  newPrinter: "เพิ่มเครื่องพิมพ์",
  printPath: "รูปแบบสั่งพิมพ์",
  networkTitle: "แบบสาย / LAN",
  networkDesc: "เครื่อง ESC/POS ผ่าน IP ใช้กับเครื่องพิมพ์ LAN หรือ Wi-Fi",
  webTitle: "พิมพ์ผ่านเว็บแอป",
  webDesc: "เรียก Star WebPRNT endpoint จากระบบหลังบ้าน",
  appTitle: "พิมพ์ผ่านแอป / Local Bridge",
  appDesc: "แอปในเครื่องรับงานจาก CpIPOS แล้วส่งไป USB หรือ driver printer",
  bluetoothTitle: "Bluetooth Bridge",
  bluetoothDesc: "แอป Bridge เชื่อมต่อและพิมพ์ไปเครื่อง Bluetooth 58mm",
  printerName: "ชื่อเครื่องพิมพ์",
  role: "หน้าที่",
  receipt: "ใบเสร็จ",
  kitchen: "ครัว",
  report: "รายงาน",
  paper: "กระดาษ",
  ipAddress: "IP address",
  port: "พอร์ต",
  bridgeUrl: "Bridge URL",
  webprntUrl: "WebPRNT URL",
  bluetoothAddress: "Bluetooth address",
  bluetoothName: "ชื่อ Bluetooth",
  agentDeviceCode: "ผูกกับรหัสเครื่อง",
  enabled: "เปิดใช้งาน",
  autoConnect: "เชื่อมต่ออัตโนมัติ",
  connectBeforePrint: "เชื่อมต่อก่อนพิมพ์",
  cashDrawer: "ลิ้นชักเก็บเงิน",
  autoOpenCash: "เปิดเมื่อรับเงินสด",
  advancedMetadata: "Metadata JSON ขั้นสูง",
  advancedMetadataHint: "ใส่เฉพาะค่าพิเศษ ระบบจะรวมกับค่าจากฟอร์มให้อัตโนมัติ",
  saving: "กำลังบันทึก...",
  addPrinter: "บันทึกเครื่องพิมพ์",
  loadPrinters: "กำลังโหลดเครื่องพิมพ์...",
  noPrinters: "ยังไม่ได้ตั้งค่าเครื่องพิมพ์",
  printerCreated: "สร้างเครื่องพิมพ์แล้ว",
  createPrinterFailed: "สร้างเครื่องพิมพ์ไม่สำเร็จ",
  metadataInvalid: "Metadata ขั้นสูงต้องเป็น JSON object ที่ถูกต้อง",
  requiredNetwork: "แบบสาย / LAN ต้องใส่ IP address",
  requiredBridge: "พิมพ์ผ่านแอปหรือ Bluetooth ต้องใส่ Bridge URL",
  requiredWebprnt: "พิมพ์ผ่านเว็บแอปต้องใส่ WebPRNT URL",
  requiredBluetooth: "Bluetooth ต้องใส่ address หรือชื่อเครื่อง",
  status: "สถานะ",
  online: "ออนไลน์",
  offline: "ออฟไลน์",
  checking: "กำลังตรวจสอบ",
  testPrint: "ทดสอบพิมพ์",
  testing: "กำลังทดสอบ...",
  testQueued: "ส่งทดสอบพิมพ์แล้ว",
  testFailed: "ทดสอบพิมพ์ไม่สำเร็จ",
  scanBluetooth: "ค้นหา Bluetooth",
  scanning: "กำลังค้นหา...",
  noDevices: "ไม่พบอุปกรณ์ Bluetooth",
  useDevice: "ใช้เครื่องนี้",
  connecting: "กำลังเชื่อมต่อ...",
  connectDevice: "เชื่อมต่อ",
  connectedMessage: "เชื่อมต่อ Bluetooth แล้ว",
  appliedBluetooth: "เลือกเครื่อง Bluetooth แล้ว",
  discoveryFailed: "ค้นหา Bluetooth ไม่สำเร็จ",
  bridgeHealthFailed: "ตรวจสอบ Bridge ไม่สำเร็จ",
  debugPrint58: "ทดสอบ 58mm",
  testingPrint: "กำลังทดสอบพิมพ์...",
  printDebugComplete: "ทดสอบพิมพ์ Bluetooth เสร็จแล้ว",
  printDebugFailed: "ทดสอบพิมพ์ Bluetooth ไม่สำเร็จ",
  localAgents: "แอปพิมพ์ / Print Agent",
  agentName: "ชื่อ Agent",
  deviceCode: "รหัสเครื่อง",
  appVersion: "เวอร์ชันแอป",
  agentMetadata: "Metadata Agent JSON",
  createAgentSecret: "สร้าง Secret",
  creating: "กำลังสร้าง...",
  copySecretNow: "คัดลอก secret ตอนนี้ ระบบแสดงให้เห็นครั้งเดียวเท่านั้น",
  copySecret: "คัดลอก secret",
  loadingAgents: "กำลังโหลดแอปพิมพ์...",
  noAgents: "ยังไม่มี Print Agent",
  revoke: "ยกเลิกสิทธิ์",
  block: "บล็อก",
  createAgentFailed: "สร้าง Print Agent ไม่สำเร็จ",
  updateAgentFailed: "อัปเดต Print Agent ไม่สำเร็จ",
  agentBlocked: "บล็อก Print Agent แล้ว",
  agentRevoked: "ยกเลิกสิทธิ์ Print Agent แล้ว",
  assignmentTitle: "กติกาผูกเครื่องพิมพ์",
  assignmentText: "ผูกเครื่องพิมพ์ตามหน้าที่และรหัสเครื่อง เพื่อให้แต่ละจุดแคชเชียร์พิมพ์ใบเสร็จ ครัว หรือรายงานถูกเครื่อง",
  routeReceipt: "เครื่องใบเสร็จใช้พิมพ์บิล พิมพ์ซ้ำ และสั่งเปิดลิ้นชัก",
  routeKitchen: "เครื่องครัวรับใบสั่งจากหน้าขายและ QR ลูกค้านั่งโต๊ะ",
  routeDevice: "การผูกเครื่องใช้ metadata agent_device_code หรือ agent_device_codes",
  debugPanel: "ข้อมูล Debug Bridge",
  address: "ที่อยู่",
  yes: "ใช่",
  no: "ไม่ใช่"
} as const;

const panelStyle: CSSProperties = { border: "1px solid #d8e0ea", borderRadius: 8, padding: 14, background: "#fff" };
const labelStyle: CSSProperties = { display: "grid", gap: 6, color: "#344054", fontSize: 13, fontWeight: 700 };
const inputStyle: CSSProperties = { minHeight: 42, borderRadius: 8, border: "1px solid #cdd5df", padding: "8px 10px", background: "#fff", color: "#101828" };
const buttonStyle: CSSProperties = { minHeight: 40, borderRadius: 8, border: "1px solid #cdd5df", background: "#fff", color: "#101828", padding: "0 14px", fontWeight: 800, cursor: "pointer" };
const primaryButtonStyle: CSSProperties = { ...buttonStyle, borderColor: "#175cd3", background: "#175cd3", color: "#fff" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonObject(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error("metadata_not_object");
  return parsed;
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function metadataValue(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout<T = unknown>(input: RequestInfo | URL, init: RequestInit, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return { response, body: await readJson<T>(response) };
  } finally {
    window.clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function connectionLabel(type: ConnectionType) {
  if (type === "NETWORK_ESC_POS") return text.networkTitle;
  if (type === "STAR_WEBPRNT") return text.webTitle;
  if (type === "LOCAL_BRIDGE") return text.appTitle;
  return text.bluetoothTitle;
}

function printerAddress(printer: PrinterRow) {
  const metadata = printer.metadata ?? {};
  if (printer.connection_type === "NETWORK_ESC_POS") return printer.ip_address ? `${printer.ip_address}:${printer.port ?? 9100}` : "-";
  if (printer.connection_type === "STAR_WEBPRNT") return metadataValue(metadata, "webprnt_url") ?? "-";
  if (printer.connection_type === "LOCAL_BRIDGE") return metadataValue(metadata, "bridge_url") ?? "env:PRINT_BRIDGE_URL";
  return metadataValue(metadata, "bluetooth_address") ?? metadataValue(metadata, "bluetooth_name") ?? "-";
}

export function PrintersModule({ lang: _lang = "th" }: { lang?: "th" | "en" }) {
  const [activePanel, setActivePanel] = useState<ActivePanel>("printers");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<BluetoothDevice[]>([]);
  const [bridgeHealth, setBridgeHealth] = useState<{ ok: boolean; code: string; message: string; latencyMs: number | null } | null>(null);
  const [printingBridgeTest, setPrintingBridgeTest] = useState(false);
  const [bridgeDebug, setBridgeDebug] = useState<{ health: BridgeDebugEntry | null; discover: BridgeDebugEntry | null; connect: BridgeDebugEntry | null; print: BridgeDebugEntry | null }>({ health: null, discover: null, connect: null, print: null });
  const [agents, setAgents] = useState<PrintAgentRow[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentActionId, setAgentActionId] = useState<string | null>(null);
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentDeviceCode, setAgentDeviceCode] = useState("");
  const [agentVersion, setAgentVersion] = useState("");
  const [agentMetadataText, setAgentMetadataText] = useState("");
  const [createdAgentKey, setCreatedAgentKey] = useState<{ agentName: string; deviceCode: string; key: string } | null>(null);
  const [printerName, setPrinterName] = useState("");
  const [printerRole, setPrinterRole] = useState<PrinterRole>("receipt");
  const [connectionType, setConnectionType] = useState<ConnectionType>("NETWORK_ESC_POS");
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(58);
  const [ipAddress, setIpAddress] = useState("");
  const [portValue, setPortValue] = useState("9100");
  const [bridgeUrlInput, setBridgeUrlInput] = useState("http://127.0.0.1:3210/print");
  const [webprntUrl, setWebprntUrl] = useState("");
  const [bluetoothAddress, setBluetoothAddress] = useState("");
  const [bluetoothName, setBluetoothName] = useState("");
  const [agentDeviceBinding, setAgentDeviceBinding] = useState("");
  const [autoConnect, setAutoConnect] = useState(true);
  const [connectBeforePrint, setConnectBeforePrint] = useState(true);
  const [cashDrawerEnabled, setCashDrawerEnabled] = useState(false);
  const [cashDrawerAutoOpen, setCashDrawerAutoOpen] = useState(false);
  const [metadataTextValue, setMetadataTextValue] = useState("");
  const [enabled, setEnabled] = useState(true);

  const isBridgeMode = connectionType === "LOCAL_BRIDGE" || connectionType === "BLUETOOTH_BRIDGE";
  const isBluetoothMode = connectionType === "BLUETOOTH_BRIDGE";
  const isNetworkMode = connectionType === "NETWORK_ESC_POS";
  const isWebMode = connectionType === "STAR_WEBPRNT";
  const { loading, error, items, pagination } = usePaginatedApi<PrinterRow>("/api/backoffice/printers", { page, page_size: 10, reload: reloadKey });

  const connectionOptions = useMemo(() => [
    { type: "NETWORK_ESC_POS" as const, title: text.networkTitle, desc: text.networkDesc },
    { type: "LOCAL_BRIDGE" as const, title: text.appTitle, desc: text.appDesc },
    { type: "BLUETOOTH_BRIDGE" as const, title: text.bluetoothTitle, desc: text.bluetoothDesc },
    { type: "STAR_WEBPRNT" as const, title: text.webTitle, desc: text.webDesc }
  ], []);

  const generatedMetadata = useMemo(() => {
    const metadata: Record<string, unknown> = {};
    if (isBridgeMode && bridgeUrlInput.trim()) metadata.bridge_url = bridgeUrlInput.trim();
    if (isWebMode && webprntUrl.trim()) metadata.webprnt_url = webprntUrl.trim();
    if (isBluetoothMode) {
      if (bluetoothAddress.trim()) metadata.bluetooth_address = bluetoothAddress.trim();
      if (bluetoothName.trim()) metadata.bluetooth_name = bluetoothName.trim();
      metadata.auto_connect = autoConnect;
      metadata.connect_before_print = connectBeforePrint;
      metadata.prefer_html_58mm = paperWidthMm === 58;
    }
    if (agentDeviceBinding.trim()) metadata.agent_device_code = agentDeviceBinding.trim();
    if (cashDrawerEnabled) {
      metadata.cash_drawer = { enabled: true, connectionMode: "printer-kick", openSupported: true, statusSupported: false, closeSupported: false, kickPin: 0, pulseOnMs: 50, pulseOffMs: 250, autoOpenOnCashPayment: cashDrawerAutoOpen };
    }
    return metadata;
  }, [agentDeviceBinding, autoConnect, bluetoothAddress, bluetoothName, bridgeUrlInput, cashDrawerAutoOpen, cashDrawerEnabled, connectBeforePrint, isBluetoothMode, isBridgeMode, isWebMode, paperWidthMm, webprntUrl]);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ items?: PrintAgentRow[] }>>("/api/backoffice/printers/agents", { cache: "no-store" }, 9000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.createAgentFailed);
      setAgents(Array.isArray(body?.data?.items) ? body.data.items : []);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.createAgentFailed);
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activePanel === "agents") void loadAgents();
  }, [activePanel, loadAgents, reloadKey]);

  useEffect(() => {
    if (!isBluetoothMode) return;
    let active = true;
    let timer: number | null = null;
    const checkBridgeHealth = async () => {
      const requestPayload = { bridge_url: bridgeUrlInput.trim() || null, timeout_ms: 5000 };
      let attempts = 0;
      let backoffMs = 350;
      try {
        while (attempts < 3) {
          attempts += 1;
          const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<BridgeEnvelope<{ latency_ms?: number | null }>>>("/api/backoffice/printers/bluetooth/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestPayload) }, 6500);
          const envelope = body?.data;
          if (!active || !envelope) return;
          setBridgeDebug((current) => ({ ...current, health: { at: new Date().toISOString(), attempts, request: requestPayload, status: response.status, response: body } }));
          setBridgeHealth({ ok: envelope.ok === true, code: envelope.code, message: envelope.message, latencyMs: Number.isFinite(Number(envelope.data?.latency_ms)) ? Number(envelope.data?.latency_ms) : null });
          if (envelope.ok || attempts >= 3) break;
          await sleep(backoffMs);
          backoffMs = Math.min(2200, backoffMs * 2);
        }
      } catch {
        if (!active) return;
        setBridgeHealth({ ok: false, code: "bridge_health_failed", message: text.bridgeHealthFailed, latencyMs: null });
        setBridgeDebug((current) => ({ ...current, health: { at: new Date().toISOString(), attempts: Math.max(1, attempts), request: requestPayload, status: null, response: { error: "bridge_health_failed" } } }));
      } finally {
        if (!active) return;
        timer = window.setTimeout(checkBridgeHealth, 8000);
      }
    };
    void checkBridgeHealth();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [bridgeUrlInput, isBluetoothMode]);

  function resetPrinterForm() {
    setPrinterName("");
    setIpAddress("");
    setPortValue("9100");
    setBluetoothAddress("");
    setBluetoothName("");
    setAgentDeviceBinding("");
    setMetadataTextValue("");
    setDiscoveredDevices([]);
  }

  function applyBluetoothDevice(device: BluetoothDevice) {
    const candidateName = device.name.trim() || device.address || "Bluetooth Printer";
    setConnectionType("BLUETOOTH_BRIDGE");
    setPaperWidthMm(58);
    setPrinterRole("receipt");
    setPrinterName(candidateName.startsWith("BT ") ? candidateName : `BT ${candidateName}`);
    setBluetoothAddress(device.address ?? "");
    setBluetoothName(device.name ?? "");
    setIpAddress("");
    setPortValue("");
    setAutoConnect(true);
    setConnectBeforePrint(true);
    setSubmitSuccess(`${text.appliedBluetooth}: ${candidateName}`);
  }

  async function handleDiscoverBluetooth() {
    setDiscovering(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const requestPayload = { bridge_url: bridgeUrlInput.trim() || null, timeout_ms: 9000 };
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<BridgeEnvelope<{ bridge_url?: string; devices?: BluetoothDevice[] }>>>("/api/backoffice/printers/bluetooth/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestPayload) }, 12000);
      setBridgeDebug((current) => ({ ...current, discover: { at: new Date().toISOString(), attempts: 1, request: requestPayload, status: response.status, response: body } }));
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.discoveryFailed);
      const devices = Array.isArray(body?.data?.data?.devices) ? body.data.data.devices : [];
      setDiscoveredDevices(devices);
      if (typeof body?.data?.data?.bridge_url === "string" && body.data.data.bridge_url.trim()) setBridgeUrlInput(body.data.data.bridge_url.trim());
      setSubmitSuccess(`พบอุปกรณ์ Bluetooth: ${devices.length}`);
    } catch (discoverError) {
      setDiscoveredDevices([]);
      setSubmitError(discoverError instanceof Error ? discoverError.message : text.discoveryFailed);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleConnectBluetooth(device: BluetoothDevice) {
    setConnectingDeviceId(device.id);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const requestPayload = { bridge_url: bridgeUrlInput.trim() || null, bluetooth_address: device.address, bluetooth_name: device.name, auto_connect: true };
      let envelope: BridgeEnvelope<Record<string, unknown>> | undefined;
      let attempts = 0;
      let backoffMs = 450;
      while (attempts < 3) {
        attempts += 1;
        const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<BridgeEnvelope<Record<string, unknown>>>>("/api/backoffice/printers/bluetooth/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestPayload) }, 10000);
        envelope = body?.data;
        setBridgeDebug((current) => ({ ...current, connect: { at: new Date().toISOString(), attempts, request: requestPayload, status: response.status, response: body } }));
        const hasValidationError = response.status === 403 || response.status === 422;
        const isSuccess = response.ok && !body?.error && envelope?.ok !== false;
        if (isSuccess) break;
        if (attempts >= 3 || hasValidationError) throw new Error(body?.error?.message ?? envelope?.message ?? text.printDebugFailed);
        await sleep(backoffMs);
        backoffMs = Math.min(2400, backoffMs * 2);
      }
      applyBluetoothDevice(device);
      setSubmitSuccess(envelope?.message ?? `${text.connectedMessage}: ${device.name || device.address || "device"}`);
    } catch (connectError) {
      setSubmitError(connectError instanceof Error ? connectError.message : text.printDebugFailed);
    } finally {
      setConnectingDeviceId(null);
    }
  }

  async function handleBridgePrint58Debug() {
    setPrintingBridgeTest(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    const sampleHtml = `<!doctype html><html><head><meta charset="utf-8"/><style>@page{size:58mm 120mm;margin:0}html,body{width:58mm;margin:0;padding:0;font-family:Tahoma,sans-serif;font-size:11px}main{padding:2mm}h1{font-size:12px;margin:0 0 2mm}p{margin:0 0 1mm}</style></head><body><main><h1>Bluetooth 58mm Test</h1><p>Bridge test from printer settings.</p><p>${new Date().toISOString()}</p></main></body></html>`;
    const requestPayload = { order_id: null, order_no: `BT-TEST-${Date.now()}`, receipt_html: sampleHtml };
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ message?: string }>>("/api/pos/receipts/bluetooth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestPayload) }, 12000);
      setBridgeDebug((current) => ({ ...current, print: { at: new Date().toISOString(), attempts: 1, request: requestPayload, status: response.status, response: body } }));
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.printDebugFailed);
      setSubmitSuccess(body?.data?.message ?? text.printDebugComplete);
    } catch (printError) {
      setSubmitError(printError instanceof Error ? printError.message : text.printDebugFailed);
    } finally {
      setPrintingBridgeTest(false);
    }
  }

  async function handleCreatePrinter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      if (isNetworkMode && !normalizeText(ipAddress)) throw new Error(text.requiredNetwork);
      if (isBridgeMode && !normalizeText(bridgeUrlInput)) throw new Error(text.requiredBridge);
      if (isWebMode && !normalizeText(webprntUrl)) throw new Error(text.requiredWebprnt);
      if (isBluetoothMode && !normalizeText(bluetoothAddress) && !normalizeText(bluetoothName)) throw new Error(text.requiredBluetooth);
      const advancedMetadata = readJsonObject(metadataTextValue);
      const metadata = { ...generatedMetadata, ...advancedMetadata };
      const payload = { printer_name: printerName.trim(), printer_role: printerRole, connection_type: connectionType, ip_address: isNetworkMode ? ipAddress.trim() : null, port: isNetworkMode ? Number(portValue || 0) || 9100 : null, paper_width_mm: paperWidthMm, enabled, metadata };
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<PrinterRow>>("/api/backoffice/printers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.createPrinterFailed);
      setSubmitSuccess(`${text.printerCreated}: ${body?.data?.printer_name ?? payload.printer_name}`);
      setReloadKey((key) => key + 1);
      resetPrinterForm();
    } catch (createError) {
      setSubmitError(createError instanceof Error ? createError.message : text.createPrinterFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestPrint(printerId: string) {
    setTestingId(printerId);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ printer_id: string }>>("/api/backoffice/printers/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printer_id: printerId }) }, 15000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.testFailed);
      setSubmitSuccess(`${text.testQueued}: ${printerId}`);
      setReloadKey((key) => key + 1);
    } catch (testError) {
      setSubmitError(testError instanceof Error ? testError.message : text.testFailed);
    } finally {
      setTestingId(null);
    }
  }

  async function handleCreateAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAgentSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    setCreatedAgentKey(null);
    try {
      const metadata = readJsonObject(agentMetadataText);
      const payload = { agent_name: agentName.trim(), device_code: agentDeviceCode.trim(), app_version: agentVersion.trim() || null, metadata };
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ agent?: PrintAgentRow; agent_key?: string }>>("/api/backoffice/printers/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.createAgentFailed);
      setCreatedAgentKey({ agentName: body?.data?.agent?.agent_name ?? payload.agent_name, deviceCode: body?.data?.agent?.device_code ?? payload.device_code, key: body?.data?.agent_key ?? "" });
      setSubmitSuccess(text.copySecretNow);
      setAgentName("");
      setAgentDeviceCode("");
      setAgentVersion("");
      setAgentMetadataText("");
      setReloadKey((key) => key + 1);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.createAgentFailed);
    } finally {
      setAgentSubmitting(false);
    }
  }

  async function handleUpdateAgent(agentId: string, action: "revoke" | "block") {
    setAgentActionId(agentId);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ agent?: PrintAgentRow }>>("/api/backoffice/printers/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agentId, action }) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.updateAgentFailed);
      setSubmitSuccess(action === "block" ? text.agentBlocked : text.agentRevoked);
      setReloadKey((key) => key + 1);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.updateAgentFailed);
    } finally {
      setAgentActionId(null);
    }
  }

  return (
    <section className="surface" style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>{text.title}</h2>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", maxWidth: 760 }}>{text.description}</p>
        </div>
        {isBluetoothMode ? (
          <div style={{ ...panelStyle, padding: "8px 12px", minWidth: 220, background: bridgeHealth?.ok ? "#ecfdf3" : "#fff7ed" }}>
            <strong style={{ color: bridgeHealth?.ok ? "#067647" : "#b54708" }}>{text.status}: {bridgeHealth ? (bridgeHealth.ok ? text.online : text.offline) : text.checking}</strong>
            <div style={{ color: "#475467", fontSize: 12 }}>{bridgeHealth?.latencyMs != null ? `${bridgeHealth.latencyMs}ms` : bridgeHealth?.code ?? "-"}</div>
          </div>
        ) : null}
      </header>

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8 }} aria-label={text.title}>
        {([["printers", text.printers], ["agents", text.agents], ["assignment", text.assignment]] as Array<[ActivePanel, string]>).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActivePanel(key)} style={activePanel === key ? primaryButtonStyle : buttonStyle}>{label}</button>
        ))}
      </nav>

      {submitError ? <ErrorState message={submitError} /> : null}
      {submitSuccess ? <p style={{ margin: 0, color: "#067647", fontWeight: 800 }}>{submitSuccess}</p> : null}

      {activePanel === "printers" ? (
        <>
          <form onSubmit={handleCreatePrinter} style={{ display: "grid", gap: 14 }}>
            <section style={panelStyle}>
              <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{text.printPath}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                {connectionOptions.map((option) => (
                  <button key={option.type} type="button" onClick={() => setConnectionType(option.type)} style={{ ...panelStyle, textAlign: "left", cursor: "pointer", background: connectionType === option.type ? "#eff8ff" : "#fff", borderColor: connectionType === option.type ? "#175cd3" : "#d8e0ea" }}>
                    <strong style={{ display: "block", color: connectionType === option.type ? "#175cd3" : "#101828" }}>{option.title}</strong>
                    <span style={{ display: "block", marginTop: 4, color: "#667085", fontSize: 12 }}>{option.desc}</span>
                  </button>
                ))}
              </div>
            </section>

            <section style={panelStyle}>
              <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{text.newPrinter}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                <label style={labelStyle}>{text.printerName}<input value={printerName} onChange={(event) => setPrinterName(event.target.value)} required style={inputStyle} /></label>
                <label style={labelStyle}>{text.role}<select value={printerRole} onChange={(event) => setPrinterRole(event.target.value as PrinterRole)} style={inputStyle}><option value="receipt">{text.receipt}</option><option value="kitchen">{text.kitchen}</option><option value="report">{text.report}</option></select></label>
                <label style={labelStyle}>{text.paper}<select value={String(paperWidthMm)} onChange={(event) => setPaperWidthMm(Number(event.target.value) === 80 ? 80 : 58)} style={inputStyle}><option value="58">58mm</option><option value="80">80mm</option></select></label>
                {isNetworkMode ? <label style={labelStyle}>{text.ipAddress}<input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder="192.168.1.50" style={inputStyle} /></label> : null}
                {isNetworkMode ? <label style={labelStyle}>{text.port}<input type="number" value={portValue} onChange={(event) => setPortValue(event.target.value)} placeholder="9100" style={inputStyle} /></label> : null}
                {isBridgeMode ? <label style={labelStyle}>{text.bridgeUrl}<input value={bridgeUrlInput} onChange={(event) => setBridgeUrlInput(event.target.value)} placeholder="http://127.0.0.1:3210/print" style={inputStyle} /></label> : null}
                {isWebMode ? <label style={labelStyle}>{text.webprntUrl}<input value={webprntUrl} onChange={(event) => setWebprntUrl(event.target.value)} placeholder="http://printer.local/StarWebPRNT/SendMessage" style={inputStyle} /></label> : null}
                {isBluetoothMode ? <label style={labelStyle}>{text.bluetoothAddress}<input value={bluetoothAddress} onChange={(event) => setBluetoothAddress(event.target.value)} placeholder="AA:BB:CC:DD:EE:FF" style={inputStyle} /></label> : null}
                {isBluetoothMode ? <label style={labelStyle}>{text.bluetoothName}<input value={bluetoothName} onChange={(event) => setBluetoothName(event.target.value)} placeholder="MTP-II" style={inputStyle} /></label> : null}
                <label style={labelStyle}>{text.agentDeviceCode}<input value={agentDeviceBinding} onChange={(event) => setAgentDeviceBinding(event.target.value)} placeholder="POS-COUNTER-01" style={inputStyle} /></label>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{text.enabled}</label>
                {isBluetoothMode ? <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={autoConnect} onChange={(event) => setAutoConnect(event.target.checked)} />{text.autoConnect}</label> : null}
                {isBluetoothMode ? <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={connectBeforePrint} onChange={(event) => setConnectBeforePrint(event.target.checked)} />{text.connectBeforePrint}</label> : null}
                {printerRole === "receipt" ? <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={cashDrawerEnabled} onChange={(event) => setCashDrawerEnabled(event.target.checked)} />{text.cashDrawer}</label> : null}
                {cashDrawerEnabled ? <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={cashDrawerAutoOpen} onChange={(event) => setCashDrawerAutoOpen(event.target.checked)} />{text.autoOpenCash}</label> : null}
              </div>
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 800 }}>{text.advancedMetadata}</summary>
                <p style={{ color: "#667085", fontSize: 12 }}>{text.advancedMetadataHint}</p>
                <textarea value={metadataTextValue} onChange={(event) => setMetadataTextValue(event.target.value)} rows={5} placeholder={JSON.stringify(generatedMetadata, null, 2)} style={{ ...inputStyle, width: "100%", fontFamily: "Consolas, monospace" }} />
              </details>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
                <button type="submit" disabled={submitting} style={primaryButtonStyle}>{submitting ? text.saving : text.addPrinter}</button>
              </div>
            </section>
          </form>

          {isBluetoothMode ? (
            <section style={panelStyle}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, alignItems: "end" }}>
                <label style={labelStyle}>{text.bridgeUrl}<input value={bridgeUrlInput} onChange={(event) => setBridgeUrlInput(event.target.value)} style={inputStyle} /></label>
                <button type="button" onClick={() => void handleDiscoverBluetooth()} disabled={discovering} style={buttonStyle}>{discovering ? text.scanning : text.scanBluetooth}</button>
                <button type="button" onClick={() => void handleBridgePrint58Debug()} disabled={printingBridgeTest} style={buttonStyle}>{printingBridgeTest ? text.testingPrint : text.debugPrint58}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
                {discoveredDevices.length === 0 ? <div style={{ color: "#667085", fontSize: 13 }}>{text.noDevices}</div> : discoveredDevices.map((device) => (
                  <div key={device.id} style={{ ...panelStyle, background: "#f8fafc" }}>
                    <strong>{device.name || "Bluetooth Printer"}</strong>
                    <div style={{ color: "#667085", fontSize: 12 }}>{text.address}: {device.address ?? "-"}</div>
                    <div style={{ color: "#667085", fontSize: 12 }}>{text.status}: {device.connected ? text.online : text.offline} / RSSI {device.rssi ?? "-"}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button type="button" onClick={() => applyBluetoothDevice(device)} style={buttonStyle}>{text.useDevice}</button>
                      <button type="button" onClick={() => void handleConnectBluetooth(device)} disabled={connectingDeviceId === device.id} style={buttonStyle}>{connectingDeviceId === device.id ? text.connecting : text.connectDevice}</button>
                    </div>
                  </div>
                ))}
              </div>
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontWeight: 800 }}>{text.debugPanel}</summary>
                <pre style={{ marginTop: 8, maxHeight: 260, overflow: "auto", background: "#f8fafc", border: "1px solid #d8e0ea", padding: 10, borderRadius: 8 }}>{JSON.stringify(bridgeDebug, null, 2)}</pre>
              </details>
            </section>
          ) : null}

          <section style={panelStyle}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{text.printers}</h3>
            {loading ? <LoadingState label={text.loadPrinters} /> : null}
            {!loading && error ? <ErrorState message={error} /> : null}
            {!loading && !error && items.length === 0 ? <EmptyState label={text.noPrinters} /> : null}
            {!loading && !error && items.length > 0 ? (
              <>
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((printer) => (
                    <div key={printer.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "center", borderBottom: "1px solid #edf2f7", padding: "10px 0" }}>
                      <div><strong>{printer.printer_name}</strong><div style={{ color: "#667085", fontSize: 12 }}>{printer.printer_role} / {printer.paper_width_mm}mm</div></div>
                      <div><strong style={{ fontSize: 13 }}>{connectionLabel(printer.connection_type)}</strong><div style={{ color: "#667085", fontSize: 12, overflowWrap: "anywhere" }}>{printerAddress(printer)}</div></div>
                      <span style={{ color: printer.enabled ? "#067647" : "#b42318", fontWeight: 800 }}>{printer.enabled ? text.yes : text.no}</span>
                      <button type="button" disabled={testingId === printer.id || !printer.enabled} onClick={() => void handleTestPrint(printer.id)} style={buttonStyle}>{testingId === printer.id ? text.testing : text.testPrint}</button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}><PaginationControls page={pagination.page} totalPages={pagination.total_pages} onPageChange={setPage} /></div>
              </>
            ) : null}
          </section>
        </>
      ) : null}

      {activePanel === "agents" ? (
        <section style={panelStyle}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{text.localAgents}</h3>
          <form onSubmit={handleCreateAgent} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={labelStyle}>{text.agentName}<input value={agentName} onChange={(event) => setAgentName(event.target.value)} required style={inputStyle} /></label>
            <label style={labelStyle}>{text.deviceCode}<input value={agentDeviceCode} onChange={(event) => setAgentDeviceCode(event.target.value)} required placeholder="POS-COUNTER-01" style={inputStyle} /></label>
            <label style={labelStyle}>{text.appVersion}<input value={agentVersion} onChange={(event) => setAgentVersion(event.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>{text.agentMetadata}<input value={agentMetadataText} onChange={(event) => setAgentMetadataText(event.target.value)} placeholder='{"os":"windows"}' style={inputStyle} /></label>
            <button type="submit" disabled={agentSubmitting} style={primaryButtonStyle}>{agentSubmitting ? text.creating : text.createAgentSecret}</button>
          </form>
          {createdAgentKey ? (
            <div style={{ ...panelStyle, marginTop: 12, background: "#fff7ed", borderColor: "#fed7aa" }}>
              <strong>{text.copySecretNow}</strong>
              <div style={{ color: "#667085", fontSize: 12, marginTop: 4 }}>{createdAgentKey.agentName} / {createdAgentKey.deviceCode}</div>
              <code style={{ display: "block", overflowX: "auto", padding: 8, background: "#fff", border: "1px solid #fed7aa", borderRadius: 8, marginTop: 8 }}>{createdAgentKey.key}</code>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(createdAgentKey.key)} style={{ ...buttonStyle, marginTop: 8 }}>{text.copySecret}</button>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {agentsLoading ? <LoadingState label={text.loadingAgents} /> : null}
            {!agentsLoading && agents.length === 0 ? <EmptyState label={text.noAgents} /> : null}
            {!agentsLoading ? agents.map((agent) => (
              <div key={agent.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "center", borderBottom: "1px solid #edf2f7", padding: "10px 0" }}>
                <div><strong>{agent.agent_name}</strong><div style={{ color: "#667085", fontSize: 12 }}>{agent.app_version ?? "-"}</div></div>
                <div><strong>{agent.device_code}</strong><div style={{ color: "#667085", fontSize: 12 }}>{agent.device_id ?? "-"}</div></div>
                <div><strong>{agent.status}</strong><div style={{ color: "#667085", fontSize: 12 }}>{formatDate(agent.last_seen_at)}</div></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" disabled={agentActionId === agent.id || agent.status !== "active"} onClick={() => void handleUpdateAgent(agent.id, "revoke")} style={buttonStyle}>{text.revoke}</button>
                  <button type="button" disabled={agentActionId === agent.id || agent.status === "blocked"} onClick={() => void handleUpdateAgent(agent.id, "block")} style={buttonStyle}>{text.block}</button>
                </div>
              </div>
            )) : null}
          </div>
        </section>
      ) : null}

      {activePanel === "assignment" ? (
        <section style={panelStyle}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{text.assignmentTitle}</h3>
          <p style={{ color: "#667085", marginTop: 0 }}>{text.assignmentText}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {[text.routeReceipt, text.routeKitchen, text.routeDevice].map((item) => <div key={item} style={{ ...panelStyle, background: "#f8fafc" }}>{item}</div>)}
          </div>
          <pre style={{ marginTop: 12, overflowX: "auto", background: "#f8fafc", border: "1px solid #d8e0ea", borderRadius: 8, padding: 10 }}>{'{"agent_device_code":"POS-COUNTER-01","bridge_timeout_ms":8000}'}</pre>
        </section>
      ) : null}
    </section>
  );
}

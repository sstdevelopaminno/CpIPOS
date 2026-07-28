"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type PrinterRow = {
  id: string;
  printer_name: string;
  printer_role: "receipt" | "kitchen" | "report";
  connection_type: "NETWORK_ESC_POS" | "STAR_WEBPRNT" | "LOCAL_BRIDGE" | "BLUETOOTH_BRIDGE";
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
  created_at?: string;
  updated_at?: string;
};

type BluetoothDevice = {
  id: string;
  name: string;
  address: string | null;
  rssi: number | null;
  paired: boolean;
  connected: boolean;
};

type BridgeEnvelope<TData> = {
  ok: boolean;
  code: string;
  message: string;
  action: string;
  timestamp: string;
  data: TData;
};

type BridgeDebugEntry = {
  at: string;
  attempts: number;
  request: Record<string, unknown>;
  status: number | null;
  response: unknown;
};

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function prettyJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchJsonWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return { response, body: await readJson(response) };
  } finally {
    window.clearTimeout(timer);
  }
}

const PRINTER_MODULE_TEXT = {
  en: {
    title: "Printer Settings",
    description: "Adapter-based printing supports network printers, local print agents, Bluetooth bridge, and cash drawers.",
    sectionsLabel: "Printer settings sections",
    printers: "Printers",
    agents: "Print Agents",
    assignment: "Assignment",
    localAgents: "Local Print Agents",
    agentName: "Agent name",
    deviceCode: "Device code, e.g. POS-COUNTER-01",
    appVersion: "App version (optional)",
    creating: "Creating...",
    createAgentSecret: "Create agent secret",
    copySecretNow: "Copy this secret now. It is shown once only.",
    copySecret: "Copy secret",
    agent: "Agent",
    device: "Device",
    status: "Status",
    lastSeen: "Last seen",
    actions: "Actions",
    loadingAgents: "Loading agents...",
    noAgents: "No print agents yet.",
    revoke: "Revoke",
    block: "Block",
    assignmentTitle: "Printer Assignment",
    assignmentHint: "For multiple cashier machines in one branch, bind a printer by adding metadata such as agent_device_code, agent_device_codes, assigned_agent_id, or assigned_agent_ids.",
    drawerProfileExample: "Cash drawer profile example:",
    printerName: "Printer name",
    ipAddress: "IP address for network printer",
    port: "Port, default 9100",
    enabled: "Enabled",
    saving: "Saving...",
    addPrinter: "Add printer",
    bluetoothTitle: "Bluetooth Discovery and Auto Connect",
    bridgeStatus: "Bridge status",
    online: "online",
    offline: "offline",
    checking: "checking",
    bridgeUrl: "Bridge URL, e.g. http://127.0.0.1:3210/print",
    scanning: "Scanning...",
    scanBluetooth: "Scan Bluetooth",
    bluetoothHint: "Select a device below to fill metadata and connect before saving.",
    testingPrint: "Testing print...",
    debugPrint58: "Debug Print 58mm",
    address: "Address",
    connected: "connected",
    notConnected: "not connected",
    paired: "paired",
    notPaired: "not paired",
    useDevice: "Use device",
    connecting: "Connecting...",
    autoConnect: "Auto connect",
    debugPanel: "Bridge Debug Panel (raw response)",
    bluetoothExamples: "Bluetooth metadata examples:",
    loadingPrinters: "Loading printers...",
    noPrinters: "No printers configured yet.",
    name: "Name",
    role: "Role",
    connection: "Connection",
    paper: "Paper",
    yes: "yes",
    no: "no",
    testing: "Testing...",
    testPrint: "Test print",
    loadAgentsFailed: "Load print agents failed.",
    appliedBluetooth: "Applied Bluetooth device",
    discoveryFailed: "Bluetooth discovery failed.",
    discoveryDone: "Discovery done.",
    foundDevices: "Found",
    devicesUnit: "device(s).",
    connectFailed: "Bluetooth connect failed.",
    connectedMessage: "Bluetooth connected",
    printDebugFailed: "Bluetooth print debug failed.",
    printDebugComplete: "Bluetooth print debug complete.",
    metadataInvalid: "metadata_json must be a valid JSON object.",
    createPrinterFailed: "Create printer failed.",
    printerCreated: "Printer created",
    testQueued: "Test print queued for printer",
    updateAgentFailed: "Update print agent failed.",
    createAgentFailed: "Create print agent failed.",
    agentBlocked: "Print agent blocked.",
    agentRevoked: "Print agent revoked.",
    unknownError: "Unknown error",
    bridgeHealthFailed: "Bridge health check failed."
  },
  th: {
    title: "ตั้งค่าเครื่องพิมพ์",
    description: "รองรับเครื่องพิมพ์ผ่านเครือข่าย, Local Print Agent, Bluetooth Bridge และลิ้นชักเก็บเงิน",
    sectionsLabel: "หมวดตั้งค่าเครื่องพิมพ์",
    printers: "เครื่องพิมพ์",
    agents: "Print Agents",
    assignment: "การผูกเครื่อง",
    localAgents: "Local Print Agents",
    agentName: "ชื่อ Agent",
    deviceCode: "รหัสเครื่อง เช่น POS-COUNTER-01",
    appVersion: "เวอร์ชันแอป (ไม่บังคับ)",
    creating: "กำลังสร้าง...",
    createAgentSecret: "สร้าง Agent Secret",
    copySecretNow: "คัดลอก secret ตอนนี้ ระบบจะแสดงให้เห็นครั้งเดียวเท่านั้น",
    copySecret: "คัดลอก secret",
    agent: "Agent",
    device: "เครื่อง",
    status: "สถานะ",
    lastSeen: "เห็นล่าสุด",
    actions: "จัดการ",
    loadingAgents: "กำลังโหลด Agents...",
    noAgents: "ยังไม่มี Print Agent",
    revoke: "ยกเลิกสิทธิ์",
    block: "บล็อก",
    assignmentTitle: "การผูกเครื่องพิมพ์",
    assignmentHint: "ถ้าสาขาเดียวมีหลายเครื่อง POS ให้ผูกเครื่องพิมพ์ด้วย metadata เช่น agent_device_code, agent_device_codes, assigned_agent_id หรือ assigned_agent_ids",
    drawerProfileExample: "ตัวอย่างโปรไฟล์ลิ้นชักเก็บเงิน:",
    printerName: "ชื่อเครื่องพิมพ์",
    ipAddress: "IP address สำหรับเครื่องพิมพ์เครือข่าย",
    port: "พอร์ต ค่าเริ่มต้น 9100",
    enabled: "เปิดใช้งาน",
    saving: "กำลังบันทึก...",
    addPrinter: "เพิ่มเครื่องพิมพ์",
    bluetoothTitle: "ค้นหา Bluetooth และเชื่อมต่ออัตโนมัติ",
    bridgeStatus: "สถานะ Bridge",
    online: "ออนไลน์",
    offline: "ออฟไลน์",
    checking: "กำลังตรวจสอบ",
    bridgeUrl: "Bridge URL เช่น http://127.0.0.1:3210/print",
    scanning: "กำลังค้นหา...",
    scanBluetooth: "ค้นหา Bluetooth",
    bluetoothHint: "เลือกอุปกรณ์ด้านล่างเพื่อเติม metadata และเชื่อมต่อก่อนบันทึก",
    testingPrint: "กำลังทดสอบพิมพ์...",
    debugPrint58: "ทดสอบพิมพ์ 58mm",
    address: "ที่อยู่",
    connected: "เชื่อมต่อแล้ว",
    notConnected: "ยังไม่เชื่อมต่อ",
    paired: "จับคู่แล้ว",
    notPaired: "ยังไม่จับคู่",
    useDevice: "ใช้อุปกรณ์นี้",
    connecting: "กำลังเชื่อมต่อ...",
    autoConnect: "เชื่อมต่ออัตโนมัติ",
    debugPanel: "ข้อมูล Debug ของ Bridge",
    bluetoothExamples: "ตัวอย่าง metadata Bluetooth:",
    loadingPrinters: "กำลังโหลดเครื่องพิมพ์...",
    noPrinters: "ยังไม่ได้ตั้งค่าเครื่องพิมพ์",
    name: "ชื่อ",
    role: "หน้าที่",
    connection: "การเชื่อมต่อ",
    paper: "กระดาษ",
    yes: "ใช่",
    no: "ไม่ใช่",
    testing: "กำลังทดสอบ...",
    testPrint: "ทดสอบพิมพ์",
    loadAgentsFailed: "โหลด Print Agents ไม่สำเร็จ",
    appliedBluetooth: "เลือกอุปกรณ์ Bluetooth แล้ว",
    discoveryFailed: "ค้นหา Bluetooth ไม่สำเร็จ",
    discoveryDone: "ค้นหาเสร็จแล้ว",
    foundDevices: "พบ",
    devicesUnit: "อุปกรณ์",
    connectFailed: "เชื่อมต่อ Bluetooth ไม่สำเร็จ",
    connectedMessage: "เชื่อมต่อ Bluetooth แล้ว",
    printDebugFailed: "ทดสอบพิมพ์ Bluetooth ไม่สำเร็จ",
    printDebugComplete: "ทดสอบพิมพ์ Bluetooth เสร็จแล้ว",
    metadataInvalid: "metadata_json ต้องเป็น JSON object ที่ถูกต้อง",
    createPrinterFailed: "สร้างเครื่องพิมพ์ไม่สำเร็จ",
    printerCreated: "สร้างเครื่องพิมพ์แล้ว",
    testQueued: "ส่งทดสอบพิมพ์ไปยังเครื่อง",
    updateAgentFailed: "อัปเดต Print Agent ไม่สำเร็จ",
    createAgentFailed: "สร้าง Print Agent ไม่สำเร็จ",
    agentBlocked: "บล็อก Print Agent แล้ว",
    agentRevoked: "ยกเลิกสิทธิ์ Print Agent แล้ว",
    unknownError: "ไม่ทราบสาเหตุ",
    bridgeHealthFailed: "ตรวจสอบ Bridge ไม่สำเร็จ"
  }
} as const;

export function PrintersModule({ lang = "en" }: { lang?: "th" | "en" }) {
  const text = PRINTER_MODULE_TEXT[lang];
  const [activePanel, setActivePanel] = useState<"printers" | "agents" | "assignment">("printers");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<BluetoothDevice[]>([]);
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
  const [printerRole, setPrinterRole] = useState<PrinterRow["printer_role"]>("receipt");
  const [connectionType, setConnectionType] = useState<PrinterRow["connection_type"]>("NETWORK_ESC_POS");
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(58);
  const [ipAddress, setIpAddress] = useState("");
  const [portValue, setPortValue] = useState("");
  const [metadataText, setMetadataText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [bridgeUrlInput, setBridgeUrlInput] = useState("http://127.0.0.1:3210/print");
  const [bridgeHealth, setBridgeHealth] = useState<{ ok: boolean; code: string; message: string; latencyMs: number | null } | null>(null);
  const [printingBridgeTest, setPrintingBridgeTest] = useState(false);
  const [bridgeDebug, setBridgeDebug] = useState<{
    health: BridgeDebugEntry | null;
    discover: BridgeDebugEntry | null;
    connect: BridgeDebugEntry | null;
    print: BridgeDebugEntry | null;
  }>({
    health: null,
    discover: null,
    connect: null,
    print: null
  });

  const isBluetoothMode = connectionType === "BLUETOOTH_BRIDGE";
  const metadataPlaceholder = useMemo(() => {
    if (connectionType === "STAR_WEBPRNT") {
      return '{"webprnt_url":"http://printer.local/StarWebPRNT/SendMessage"}';
    }
    if (connectionType === "LOCAL_BRIDGE") {
      return '{"bridge_url":"http://127.0.0.1:3210/print","cash_drawer":{"enabled":true,"connectionMode":"printer-kick","openSupported":true,"statusSupported":false,"closeSupported":false,"kickPin":0,"pulseOnMs":50,"pulseOffMs":250,"autoOpenOnCashPayment":false}}';
    }
    if (connectionType === "BLUETOOTH_BRIDGE") {
      return '{"bridge_url":"http://127.0.0.1:3210/print","bluetooth_address":"AA:BB:CC:DD:EE:FF","auto_connect":true,"cash_drawer":{"enabled":true,"connectionMode":"printer-kick","openSupported":true,"statusSupported":false,"closeSupported":false,"kickPin":0,"pulseOnMs":50,"pulseOffMs":250,"autoOpenOnCashPayment":false}}';
    }
    return '{"cash_drawer":{"enabled":true,"connectionMode":"printer-kick","openSupported":true,"statusSupported":false,"closeSupported":false,"kickPin":0,"pulseOnMs":50,"pulseOffMs":250,"autoOpenOnCashPayment":false}}';
  }, [connectionType]);

  const { loading, error, items, pagination } = usePaginatedApi<PrinterRow>("/api/backoffice/printers", {
    page,
    page_size: 10,
    reload: reloadKey
  });

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const { response, body } = await fetchJsonWithTimeout("/api/backoffice/printers/agents", { cache: "no-store" }, 9000);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.loadAgentsFailed);
      }
      setAgents(Array.isArray(body?.data?.items) ? body.data.items : []);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.loadAgentsFailed);
    } finally {
      setAgentsLoading(false);
    }
  }, [text.loadAgentsFailed]);

  useEffect(() => {
    if (activePanel === "agents") {
      void loadAgents();
    }
  }, [activePanel, loadAgents, reloadKey]);

  useEffect(() => {
    if (!isBluetoothMode) return;
    let active = true;
    let timer: number | null = null;

    const checkBridgeHealth = async () => {
      const requestPayload = { bridge_url: bridgeUrlInput.trim() || null };
      let attempts = 0;
      let backoffMs = 350;
      try {
        while (attempts < 3) {
          attempts += 1;
          const { response, body } = await fetchJsonWithTimeout("/api/backoffice/printers/bluetooth/health", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload)
          }, 5000);
          const typedBody = body as { data?: BridgeEnvelope<{ latency_ms?: number | null }> } | null;
          const envelope = typedBody?.data;
          if (!active || !envelope) return;
          setBridgeDebug((current) => ({
            ...current,
            health: {
              at: new Date().toISOString(),
              attempts,
              request: requestPayload,
              status: response.status,
              response: body
            }
          }));
          setBridgeHealth({
            ok: envelope.ok === true,
            code: envelope.code,
            message: envelope.message,
            latencyMs: Number.isFinite(Number(envelope.data?.latency_ms)) ? Number(envelope.data?.latency_ms) : null
          });
          if (envelope.ok || attempts >= 3) {
            break;
          }
          await sleep(backoffMs);
          backoffMs = Math.min(2200, backoffMs * 2);
        }
      } catch {
        if (!active) return;
        setBridgeHealth({
          ok: false,
          code: "bridge_health_check_failed",
          message: text.bridgeHealthFailed,
          latencyMs: null
        });
        setBridgeDebug((current) => ({
          ...current,
          health: {
            at: new Date().toISOString(),
            attempts: Math.max(1, attempts),
            request: requestPayload,
            status: null,
            response: { error: "bridge_health_check_failed" }
          }
        }));
      } finally {
        if (!active) return;
        timer = window.setTimeout(checkBridgeHealth, 8000);
      }
    };

    void checkBridgeHealth();
    return () => {
      active = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [bridgeUrlInput, isBluetoothMode, text.bridgeHealthFailed]);

  function applyBluetoothDevice(device: BluetoothDevice) {
    const candidateName = device.name.trim() || device.address || "Bluetooth Printer";
    const metadata = {
      bridge_url: bridgeUrlInput.trim() || "http://127.0.0.1:3210/print",
      bluetooth_address: device.address,
      bluetooth_name: device.name,
      auto_connect: true,
      connect_before_print: true,
      prefer_html_58mm: true,
      paper_width_mm: 58
    };
    setConnectionType("BLUETOOTH_BRIDGE");
    setPaperWidthMm(58);
    setPrinterRole("receipt");
    setPrinterName(candidateName.startsWith("BT ") ? candidateName : `BT ${candidateName}`);
    setIpAddress("");
    setPortValue("");
    setMetadataText(prettyJson(metadata));
    setSubmitSuccess(`${text.appliedBluetooth}: ${candidateName}`);
  }

  async function handleDiscoverBluetooth() {
    setDiscovering(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const requestPayload = {
        bridge_url: bridgeUrlInput.trim() || null,
        timeout_ms: 9000
      };
      const { response, body } = await fetchJsonWithTimeout("/api/backoffice/printers/bluetooth/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      }, 12000);
      setBridgeDebug((current) => ({
        ...current,
        discover: {
          at: new Date().toISOString(),
          attempts: 1,
          request: requestPayload,
          status: response.status,
          response: body
        }
      }));
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.discoveryFailed);
      }
      const envelope = body?.data as BridgeEnvelope<{ bridge_url?: string; devices?: BluetoothDevice[] }> | undefined;
      const devices = Array.isArray(envelope?.data?.devices) ? envelope!.data.devices! : [];
      setDiscoveredDevices(devices);
      if (typeof envelope?.data?.bridge_url === "string" && envelope.data.bridge_url.trim().length > 0) {
        setBridgeUrlInput(envelope.data.bridge_url.trim());
      }
      setSubmitSuccess(`${envelope?.message ?? text.discoveryDone} ${text.foundDevices} ${devices.length} ${text.devicesUnit}`);
    } catch (discoverError) {
      setDiscoveredDevices([]);
      setSubmitError(discoverError instanceof Error ? discoverError.message : text.unknownError);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleConnectBluetooth(device: BluetoothDevice) {
    setConnectingDeviceId(device.id);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const requestPayload = {
        bridge_url: bridgeUrlInput.trim() || null,
        bluetooth_address: device.address,
        bluetooth_name: device.name,
        auto_connect: true
      };
      let response: Response | null = null;
      let body: unknown = null;
      let envelope: BridgeEnvelope<Record<string, unknown>> | undefined;
      let attempts = 0;
      let backoffMs = 450;

      while (attempts < 3) {
        attempts += 1;
        const result = await fetchJsonWithTimeout("/api/backoffice/printers/bluetooth/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload)
        }, 10000);
        response = result.response;
        body = result.body;
        envelope = (body as { data?: BridgeEnvelope<Record<string, unknown>> } | null)?.data;
        setBridgeDebug((current) => ({
          ...current,
          connect: {
            at: new Date().toISOString(),
            attempts,
            request: requestPayload,
            status: response?.status ?? null,
            response: body
          }
        }));

        const hasValidationError = response.status === 403 || response.status === 422;
        const isSuccess = response.ok && !(body as { error?: unknown } | null)?.error && envelope?.ok !== false;
        if (isSuccess) {
          break;
        }
        if (attempts >= 3 || hasValidationError) {
          throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? envelope?.message ?? text.connectFailed);
        }
        await sleep(backoffMs);
        backoffMs = Math.min(2400, backoffMs * 2);
      }

      applyBluetoothDevice(device);
      setSubmitSuccess(envelope?.message ?? `${text.connectedMessage}: ${device.name || device.address || "device"}`);
    } catch (connectError) {
      setSubmitError(connectError instanceof Error ? connectError.message : text.unknownError);
    } finally {
      setConnectingDeviceId(null);
    }
  }

  async function handleBridgePrint58Debug() {
    setPrintingBridgeTest(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    const sampleHtml = `<!doctype html><html><head><meta charset="utf-8"/><style>@page{size:58mm 120mm;margin:0}html,body{width:58mm;margin:0;padding:0;font-family:Tahoma,sans-serif;font-size:11px}main{padding:2mm}h1{font-size:12px;margin:0 0 2mm}p{margin:0 0 1mm}</style></head><body><main><h1>Bluetooth 58mm Test</h1><p>Bridge test from printer settings.</p><p>${new Date().toISOString()}</p></main></body></html>`;
    const requestPayload = {
      order_id: null,
      order_no: `BT-TEST-${Date.now()}`,
      receipt_html: sampleHtml
    };
    try {
      const { response, body } = await fetchJsonWithTimeout("/api/pos/receipts/bluetooth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      }, 12000);
      setBridgeDebug((current) => ({
        ...current,
        print: {
          at: new Date().toISOString(),
          attempts: 1,
          request: requestPayload,
          status: response.status,
          response: body
        }
      }));
      if (!response.ok || (body as { error?: unknown } | null)?.error) {
        throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? text.printDebugFailed);
      }
      const message = (body as { data?: { message?: string } } | null)?.data?.message ?? text.printDebugComplete;
      setSubmitSuccess(message);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : text.unknownError);
    } finally {
      setPrintingBridgeTest(false);
    }
  }

  async function handleCreatePrinter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    let metadata: Record<string, unknown> = {};
    if (metadataText.trim()) {
      try {
        metadata = JSON.parse(metadataText) as Record<string, unknown>;
      } catch {
        setSubmitError(text.metadataInvalid);
        setSubmitting(false);
        return;
      }
    }

    const payload = {
      printer_name: printerName.trim(),
      printer_role: printerRole,
      connection_type: connectionType,
      ip_address: ipAddress.trim() || null,
      port: Number(portValue || 0) || null,
      paper_width_mm: paperWidthMm,
      enabled,
      metadata
    };

    try {
      const { response, body } = await fetchJsonWithTimeout("/api/backoffice/printers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, 10000);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.createPrinterFailed);
      }
      setSubmitSuccess(`${text.printerCreated}: ${body?.data?.printer_name ?? payload.printer_name}`);
      setReloadKey((key) => key + 1);
      setPrinterName("");
      setIpAddress("");
      setPortValue("");
      setMetadataText("");
      setDiscoveredDevices([]);
    } catch (createError) {
      setSubmitError(createError instanceof Error ? createError.message : text.unknownError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestPrint(printerId: string) {
    setTestingId(printerId);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const { response, body } = await fetchJsonWithTimeout("/api/backoffice/printers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printer_id: printerId })
      }, 12000);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.printDebugFailed);
      }
      setSubmitSuccess(`${text.testQueued} ${printerId}`);
      setReloadKey((key) => key + 1);
    } catch (testError) {
      setSubmitError(testError instanceof Error ? testError.message : text.unknownError);
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

    let metadata: Record<string, unknown> = {};
    if (agentMetadataText.trim()) {
      try {
        metadata = JSON.parse(agentMetadataText) as Record<string, unknown>;
      } catch {
        setSubmitError(text.metadataInvalid);
        setAgentSubmitting(false);
        return;
      }
    }

    try {
      const payload = {
        agent_name: agentName.trim(),
        device_code: agentDeviceCode.trim(),
        app_version: agentVersion.trim() || null,
        metadata
      };
      const { response, body } = await fetchJsonWithTimeout("/api/backoffice/printers/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, 10000);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.createAgentFailed);
      }
      setCreatedAgentKey({
        agentName: body?.data?.agent?.agent_name ?? payload.agent_name,
        deviceCode: body?.data?.agent?.device_code ?? payload.device_code,
        key: body?.data?.agent_key ?? ""
      });
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
      const { response, body } = await fetchJsonWithTimeout("/api/backoffice/printers/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, action })
      }, 10000);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.updateAgentFailed);
      }
      setSubmitSuccess(action === "block" ? text.agentBlocked : text.agentRevoked);
      setReloadKey((key) => key + 1);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.updateAgentFailed);
    } finally {
      setAgentActionId(null);
    }
  }

  return (
    <section className="surface">
      <h2>{text.title}</h2>
      <p style={{ color: "var(--muted)" }}>{text.description}</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }} aria-label={text.sectionsLabel}>
        {[
          ["printers", text.printers],
          ["agents", text.agents],
          ["assignment", text.assignment]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActivePanel(key as typeof activePanel)}
            style={{
              minHeight: 38,
              borderRadius: 8,
              border: "1px solid var(--border)",
              padding: "0 14px",
              fontWeight: 800,
              background: activePanel === key ? "#0f172a" : "#fff",
              color: activePanel === key ? "#fff" : "var(--text)"
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activePanel === "agents" ? (
        <section style={{ marginBottom: 12, border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
          <h3 style={{ margin: "0 0 6px" }}>{text.localAgents}</h3>
          <form className="grid cols-4" onSubmit={handleCreateAgent} style={{ marginTop: 10 }}>
            <input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder={text.agentName} required style={{ minHeight: 42, padding: "8px 10px" }} />
            <input value={agentDeviceCode} onChange={(event) => setAgentDeviceCode(event.target.value)} placeholder={text.deviceCode} required style={{ minHeight: 42, padding: "8px 10px" }} />
            <input value={agentVersion} onChange={(event) => setAgentVersion(event.target.value)} placeholder={text.appVersion} style={{ minHeight: 42, padding: "8px 10px" }} />
            <input value={agentMetadataText} onChange={(event) => setAgentMetadataText(event.target.value)} placeholder='{"os":"windows","station":"counter"}' style={{ minHeight: 42, padding: "8px 10px" }} />
            <button type="submit" disabled={agentSubmitting} style={{ minHeight: 42 }}>
              {agentSubmitting ? text.creating : text.createAgentSecret}
            </button>
          </form>
          {createdAgentKey ? (
            <div style={{ marginTop: 10, border: "1px solid #fed7aa", background: "#fff7ed", borderRadius: 8, padding: 10 }}>
              <strong>{text.copySecretNow}</strong>
              <p style={{ margin: "6px 0", color: "var(--muted)", fontSize: 12 }}>
                {createdAgentKey.agentName} / {createdAgentKey.deviceCode}
              </p>
              <code style={{ display: "block", overflowX: "auto", padding: 8, background: "#fff", border: "1px solid var(--border)", borderRadius: 6 }}>
                {createdAgentKey.key}
              </code>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(createdAgentKey.key)} style={{ marginTop: 8, minHeight: 34 }}>
                {text.copySecret}
              </button>
            </div>
          ) : null}
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.agent}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.device}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.status}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.lastSeen}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {agentsLoading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 8 }}>{text.loadingAgents}</td>
                  </tr>
                ) : agents.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 8 }}>{text.noAgents}</td>
                  </tr>
                ) : (
                  agents.map((agent) => (
                    <tr key={agent.id}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        <strong>{agent.agent_name}</strong>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{agent.app_version ?? "-"}</div>
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{agent.device_code}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{agent.status}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{agent.last_seen_at ? new Date(agent.last_seen_at).toLocaleString() : "-"}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, display: "flex", gap: 8 }}>
                        <button type="button" disabled={agentActionId === agent.id || agent.status !== "active"} onClick={() => void handleUpdateAgent(agent.id, "revoke")} style={{ minHeight: 34 }}>
                          {text.revoke}
                        </button>
                        <button type="button" disabled={agentActionId === agent.id || agent.status === "blocked"} onClick={() => void handleUpdateAgent(agent.id, "block")} style={{ minHeight: 34 }}>
                          {text.block}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activePanel === "assignment" ? (
        <section style={{ marginBottom: 12, border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
          <h3 style={{ margin: "0 0 6px" }}>{text.assignmentTitle}</h3>
          <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: 13 }}>
            {text.assignmentHint}
          </p>
          <code>{'{"agent_device_code":"POS-COUNTER-01","bridge_timeout_ms":8000}'}</code>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>
            {text.drawerProfileExample} <code>{'{"cash_drawer":{"enabled":true,"connectionMode":"printer-kick","openSupported":true,"statusSupported":false,"closeSupported":false,"kickPin":0,"pulseOnMs":50,"pulseOffMs":250,"autoOpenOnCashPayment":false}}'}</code>
          </p>
        </section>
      ) : null}

      <form className="grid cols-4" onSubmit={handleCreatePrinter}>
        <input
          name="printer_name"
          value={printerName}
          onChange={(event) => setPrinterName(event.target.value)}
          placeholder={text.printerName}
          required
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <select name="printer_role" value={printerRole} onChange={(event) => setPrinterRole(event.target.value as PrinterRow["printer_role"])} style={{ minHeight: 42 }}>
          <option value="receipt">receipt</option>
          <option value="kitchen">kitchen</option>
          <option value="report">report</option>
        </select>
        <select
          name="connection_type"
          value={connectionType}
          onChange={(event) => setConnectionType(event.target.value as PrinterRow["connection_type"])}
          style={{ minHeight: 42 }}
        >
          <option value="NETWORK_ESC_POS">NETWORK_ESC_POS</option>
          <option value="STAR_WEBPRNT">STAR_WEBPRNT</option>
          <option value="LOCAL_BRIDGE">LOCAL_BRIDGE</option>
          <option value="BLUETOOTH_BRIDGE">BLUETOOTH_BRIDGE</option>
        </select>
        <select
          name="paper_width_mm"
          value={String(paperWidthMm)}
          onChange={(event) => setPaperWidthMm(Number(event.target.value) === 80 ? 80 : 58)}
          style={{ minHeight: 42 }}
        >
          <option value="58">58mm</option>
          <option value="80">80mm</option>
        </select>
        <input
          name="ip_address"
          value={ipAddress}
          onChange={(event) => setIpAddress(event.target.value)}
          placeholder={text.ipAddress}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <input
          name="port"
          type="number"
          value={portValue}
          onChange={(event) => setPortValue(event.target.value)}
          placeholder={text.port}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <input
          name="metadata_json"
          value={metadataText}
          onChange={(event) => setMetadataText(event.target.value)}
          placeholder={metadataPlaceholder}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input name="enabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          {text.enabled}
        </label>
        <button type="submit" disabled={submitting} style={{ minHeight: 42 }}>
          {submitting ? text.saving : text.addPrinter}
        </button>
      </form>

      {isBluetoothMode ? (
        <section style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: "0 0 8px" }}>{text.bluetoothTitle}</h3>
          <div style={{ marginBottom: 8, fontSize: 12, color: bridgeHealth?.ok ? "#067647" : "#b42318" }}>
            {text.bridgeStatus}: {bridgeHealth ? (bridgeHealth.ok ? text.online : text.offline) : text.checking}
            {bridgeHealth?.latencyMs != null ? ` (${bridgeHealth.latencyMs}ms)` : ""}
            {bridgeHealth?.message ? ` - ${bridgeHealth.message}` : ""}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
            <input
              value={bridgeUrlInput}
              onChange={(event) => setBridgeUrlInput(event.target.value)}
              placeholder={text.bridgeUrl}
              style={{ minHeight: 40, padding: "8px 10px" }}
            />
            <button type="button" onClick={() => void handleDiscoverBluetooth()} disabled={discovering} style={{ minHeight: 40, padding: "0 16px" }}>
              {discovering ? text.scanning : text.scanBluetooth}
            </button>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>
            {text.bluetoothHint}
          </p>
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={() => void handleBridgePrint58Debug()} disabled={printingBridgeTest} style={{ minHeight: 34 }}>
              {printingBridgeTest ? text.testingPrint : text.debugPrint58}
            </button>
          </div>

          {discoveredDevices.length > 0 ? (
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.device}</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.address}</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.status}</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {discoveredDevices.map((device) => (
                    <tr key={device.id}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        <strong>{device.name || "-"}</strong>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>RSSI: {device.rssi ?? "-"}</div>
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{device.address ?? "-"}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        {device.connected ? text.connected : text.notConnected} / {device.paired ? text.paired : text.notPaired}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => applyBluetoothDevice(device)} style={{ minHeight: 34 }}>
                          {text.useDevice}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleConnectBluetooth(device)}
                          disabled={connectingDeviceId === device.id}
                          style={{ minHeight: 34 }}
                        >
                          {connectingDeviceId === device.id ? text.connecting : text.autoConnect}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {isBluetoothMode ? (
        <details style={{ marginTop: 10 }}>
          <summary>{text.debugPanel}</summary>
          <pre style={{ marginTop: 8, maxHeight: 260, overflow: "auto", background: "#f8fafc", border: "1px solid var(--border)", padding: 10, borderRadius: 8 }}>
            {JSON.stringify(bridgeDebug, null, 2)}
          </pre>
        </details>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
        <p style={{ margin: "0 0 6px" }}>{text.bluetoothExamples}</p>
        <p style={{ margin: "0 0 4px" }}>
          <code>{'{"bridge_url":"http://127.0.0.1:3210/print","bluetooth_address":"AA:BB:CC:DD:EE:FF","auto_connect":true}'}</code>
        </p>
        <p style={{ margin: 0 }}>
          <code>{'{"bridge_url":"http://127.0.0.1:3210/print","bluetooth_name":"MTP-II","auto_connect":true}'}</code>
        </p>
      </div>

      {submitError ? <ErrorState message={submitError} /> : null}
      {submitSuccess ? <p style={{ color: "#067647" }}>{submitSuccess}</p> : null}

      {loading ? <LoadingState label={text.loadingPrinters} /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState label={text.noPrinters} /> : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.name}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.role}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.connection}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.address}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.paper}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.enabled}</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((printer) => (
                  <tr key={printer.id}>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.printer_name}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.printer_role}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.connection_type}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {printer.ip_address ? `${printer.ip_address}:${printer.port ?? 9100}` : "-"}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.paper_width_mm}mm</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.enabled ? text.yes : text.no}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      <button type="button" disabled={testingId === printer.id} onClick={() => handleTestPrint(printer.id)} style={{ minHeight: 36 }}>
                        {testingId === printer.id ? text.testing : text.testPrint}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10 }}>
            <PaginationControls page={pagination.page} totalPages={pagination.total_pages} onPageChange={setPage} />
          </div>
        </>
      ) : null}
    </section>
  );
}

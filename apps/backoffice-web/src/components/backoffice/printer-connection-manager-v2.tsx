"use client";

import type { ButtonHTMLAttributes, CSSProperties, FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ConnectionMode = "lan" | "usb" | "bluetooth";
type LegacyConnectionType = "NETWORK_ESC_POS" | "STAR_WEBPRNT" | "LOCAL_BRIDGE" | "BLUETOOTH_BRIDGE";
type PrinterPaperWidth = 58 | 80;
type PrinterRole = "receipt" | "kitchen" | "report";
type PrinterFunction =
  | "receipt"
  | "kitchen"
  | "drink"
  | "bar"
  | "reprint"
  | "shift_report"
  | "payment_slip"
  | "cash_drawer";
type PrinterStatus = "online" | "offline" | "checking" | "connecting" | "needs_check" | "disabled";
type DiscoverySource = "windows_runtime" | "android_mdm" | "configured_profile" | "manual_lan";

type PrinterRow = {
  id: string;
  printer_name: string;
  printer_role: PrinterRole;
  connection_type: LegacyConnectionType;
  ip_address: string | null;
  port: number | null;
  paper_width_mm: PrinterPaperWidth;
  enabled: boolean;
  metadata: Record<string, unknown> | null;
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
  metadata: Record<string, unknown> | null;
};

type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ApiError = { message?: string; code?: string };
type ApiEnvelope<T> = { data?: T; error?: ApiError };

type PrinterListResponse = {
  items: PrinterRow[];
  pagination?: PaginationMeta;
};

type AgentListResponse = {
  items: PrintAgentRow[];
};

type DiscoveryCandidate = {
  id: string;
  name: string;
  mode: ConnectionMode;
  paper_width_mm: PrinterPaperWidth;
  source: DiscoverySource;
  status: PrinterStatus;
  runtime_device_code: string | null;
  printer_profile_id: string | null;
  functions: string[];
  capabilities: Record<string, boolean>;
  helper: string;
};

type DiscoveryResponse = {
  items: DiscoveryCandidate[];
  mode: ConnectionMode | "all";
  note: string;
};

type DrawerTestResponse = {
  command_sent: boolean;
  command_queued: boolean;
  drawer_mode: string;
  physical_status: string;
  event_id: string;
  job_id: string;
  job_status: string;
};

const PAGE_SIZE = 8;
const BROWSER_AGENT_BRIDGE_URL = "browser-agent://web-serial";

const modeCards: Array<{ mode: ConnectionMode; title: string; icon: string; description: string; helper: string }> = [
  { mode: "lan", title: "LAN", icon: "🌐", description: "เครื่องพิมพ์ผ่าน IP / สาย LAN / Wi‑Fi", helper: "เหมาะกับครัวหรือจุดพิมพ์หลายจุดในร้าน" },
  { mode: "usb", title: "USB", icon: "🔌", description: "เครื่องพิมพ์ต่อกับเครื่อง POS หลัก", helper: "แนะนำสำหรับแคชเชียร์และลิ้นชักเงินสด" },
  { mode: "bluetooth", title: "Bluetooth", icon: "🔵", description: "เครื่องพิมพ์ Bluetooth / Android / MDM", helper: "เหมาะกับ Android หรือจุดขายเคลื่อนที่" }
];

const functionOptions: Array<{ value: PrinterFunction; label: string; description: string }> = [
  { value: "receipt", label: "ใบเสร็จ", description: "พิมพ์บิลหลังชำระเงิน" },
  { value: "cash_drawer", label: "ลิ้นชักเงินสด", description: "สั่ง ESC/POS drawer kick" },
  { value: "kitchen", label: "ครัว", description: "ใบสั่งอาหารรวม" },
  { value: "drink", label: "เครื่องดื่ม", description: "ใบสั่งเครื่องดื่ม" },
  { value: "bar", label: "บาร์", description: "ใบสั่งบาร์" },
  { value: "reprint", label: "พิมพ์ซ้ำ", description: "พิมพ์ใบเสร็จซ้ำ" },
  { value: "payment_slip", label: "สลิปชำระเงิน", description: "สลิป/QR/หลักฐานจ่าย" },
  { value: "shift_report", label: "รายงานกะ", description: "สรุปเปิด/ปิดกะ" }
];

const statusText: Record<PrinterStatus, string> = {
  online: "ออนไลน์",
  offline: "ออฟไลน์",
  checking: "กำลังตรวจสอบ",
  connecting: "กำลังเชื่อมต่อ",
  needs_check: "ต้องตรวจสอบ",
  disabled: "ปิดใช้งาน"
};

const modeText: Record<ConnectionMode, string> = {
  lan: "LAN",
  usb: "USB",
  bluetooth: "Bluetooth"
};

const sourceText: Record<DiscoverySource, string> = {
  windows_runtime: "Windows Runtime / Local Bridge",
  android_mdm: "Android / MDM",
  configured_profile: "ประวัติเครื่องเดิม",
  manual_lan: "เพิ่ม LAN เอง"
};

const pageSteps = ["เลือกสาขา", "เลือกโซนพิมพ์", "เลือกโหมด", "ค้นหาอัตโนมัติ", "ทดสอบพิมพ์", "บันทึก"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function isPrinterFunction(value: string): value is PrinterFunction {
  return functionOptions.some((option) => option.value === value);
}

function normalizeFunctions(values: string[]): PrinterFunction[] {
  return values.filter(isPrinterFunction);
}

function readFunctions(row: PrinterRow): PrinterFunction[] {
  const metadata = asRecord(row.metadata);
  const fromMetadata = normalizeFunctions(readStringArray(metadata.print_functions));
  if (fromMetadata.length > 0) return fromMetadata;
  if (row.printer_role === "kitchen") return ["kitchen"];
  if (row.printer_role === "report") return ["shift_report"];
  return ["receipt"];
}

function deriveRole(functions: PrinterFunction[]): PrinterRole {
  if (functions.some((item) => item === "kitchen" || item === "drink" || item === "bar")) return "kitchen";
  if (functions.includes("shift_report")) return "report";
  return "receipt";
}

function inferConnectionMode(row: PrinterRow): ConnectionMode {
  const metadata = asRecord(row.metadata);
  const saved = readString(metadata.user_connection_mode ?? metadata.connection_mode ?? metadata.transport_mode);
  if (saved === "lan" || saved === "usb" || saved === "bluetooth") return saved;
  if (row.connection_type === "NETWORK_ESC_POS") return "lan";
  if (row.connection_type === "BLUETOOTH_BRIDGE") return "bluetooth";
  return "usb";
}

function inferStatus(row: PrinterRow): PrinterStatus {
  if (!row.enabled) return "disabled";
  const metadata = asRecord(row.metadata);
  const saved = readString(metadata.status ?? metadata.runtime_status ?? metadata.health_status);
  if (saved === "online" || saved === "offline" || saved === "checking" || saved === "connecting" || saved === "needs_check") return saved;
  if (metadata.last_runtime_heartbeat_at || metadata.last_seen_at) return "online";
  return "checking";
}

function getFunctionLabel(value: PrinterFunction) {
  return functionOptions.find((option) => option.value === value)?.label ?? value;
}

function formatFunctions(values: PrinterFunction[]) {
  return values.map(getFunctionLabel).join(" + ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}

async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<T> | T;
  const maybeEnvelope = envelope as ApiEnvelope<T>;
  if (!response.ok || maybeEnvelope.error) {
    throw new Error(maybeEnvelope.error?.message ?? `Request failed with status ${response.status}`);
  }
  return (maybeEnvelope.data ?? envelope) as T;
}

function toLegacyConnection(mode: ConnectionMode): LegacyConnectionType {
  if (mode === "lan") return "NETWORK_ESC_POS";
  if (mode === "bluetooth") return "BLUETOOTH_BRIDGE";
  return "LOCAL_BRIDGE";
}

function buildMetadata(params: {
  mode: ConnectionMode;
  functions: PrinterFunction[];
  branchLabel: string;
  agentDeviceCode: string;
  bluetoothName: string;
}) {
  const cashDrawerEnabled = params.functions.includes("cash_drawer");
  const agentCodes = params.agentDeviceCode.trim() ? [params.agentDeviceCode.trim()] : [];
  return {
    setup_version: "printer_connection_manager_v2",
    user_connection_mode: params.mode,
    transport_mode: params.mode,
    print_functions: params.functions,
    print_zones: params.functions,
    branch_label: params.branchLabel.trim() || null,
    queue_only: params.mode !== "lan",
    print_mode: params.mode === "lan" ? "server" : "agent",
    bridge_url: params.mode === "lan" ? undefined : BROWSER_AGENT_BRIDGE_URL,
    agent_device_codes: agentCodes,
    agent_device_code: agentCodes[0] ?? undefined,
    bluetooth_name: params.mode === "bluetooth" ? params.bluetoothName.trim() || undefined : undefined,
    cash_drawer_enabled: cashDrawerEnabled,
    cash_drawer: {
      enabled: cashDrawerEnabled,
      connectionMode: "printer-kick",
      openSupported: cashDrawerEnabled,
      statusSupported: false,
      kickPin: 0,
      pulseOnMs: 50,
      pulseOffMs: 250,
      autoOpenOnCashPayment: cashDrawerEnabled
    },
    capabilities: {
      receipt: params.functions.includes("receipt"),
      kitchen_ticket: params.functions.includes("kitchen"),
      drink_ticket: params.functions.includes("drink"),
      bar_ticket: params.functions.includes("bar"),
      reprint: params.functions.includes("reprint"),
      shift_report: params.functions.includes("shift_report"),
      payment_slip: params.functions.includes("payment_slip"),
      cash_drawer: cashDrawerEnabled,
      esc_pos: true
    },
    production_path: params.mode === "lan" ? "lan_or_runtime" : "windows_runtime_or_android_mdm",
    quarantine_replay_allowed: false,
    legacy_transport_note:
      "Customer-facing setup is limited to LAN/USB/Bluetooth. Browser Web Serial, Local Bridge, Windows Runtime, Android Bridge and MDM are internal transports."
  };
}

function buildFallbackCandidates(mode: ConnectionMode, agents: PrintAgentRow[]): DiscoveryCandidate[] {
  if (mode === "lan") {
    return [
      {
        id: "manual:lan-escpos",
        name: "เครื่องพิมพ์ LAN / ESC/POS",
        mode,
        paper_width_mm: 80,
        source: "manual_lan",
        status: "checking",
        runtime_device_code: null,
        printer_profile_id: null,
        functions: ["kitchen"],
        capabilities: { receipt: true, kitchen: true, cash_drawer: false },
        helper: "ถ้าไม่พบอัตโนมัติ ให้กรอก IP/Port เฉพาะขั้นสูง"
      }
    ];
  }

  const activeAgents = agents.filter((agent) => agent.status === "active");
  if (activeAgents.length > 0) {
    return activeAgents.slice(0, 3).map((agent) => ({
      id: `agent:${agent.id}`,
      name: agent.agent_name || agent.device_code,
      mode,
      paper_width_mm: 58,
      source: mode === "bluetooth" ? "android_mdm" : "windows_runtime",
      status: "online",
      runtime_device_code: agent.device_code,
      printer_profile_id: null,
      functions: ["receipt", "reprint", "cash_drawer"],
      capabilities: { receipt: true, kitchen: false, cash_drawer: true },
      helper: `พบ Runtime/Agent ที่เครื่อง ${agent.device_code}`
    }));
  }

  return [
    {
      id: mode === "bluetooth" ? "fallback:android-bluetooth" : "fallback:xp58-usb",
      name: mode === "bluetooth" ? "Android Bluetooth Printer" : "XP-58",
      mode,
      paper_width_mm: 58,
      source: mode === "bluetooth" ? "android_mdm" : "windows_runtime",
      status: "checking",
      runtime_device_code: "POS-COUNTER-01",
      printer_profile_id: null,
      functions: ["receipt", "reprint", "cash_drawer"],
      capabilities: { receipt: true, kitchen: false, cash_drawer: true },
      helper: mode === "bluetooth" ? "เชื่อมผ่าน Android/MDM หรือ Bluetooth Bridge" : "ต่อผ่าน Windows Runtime / Local Bridge ที่ POS-COUNTER-01"
    }
  ];
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <section style={{ border: "1px solid #dbe7f5", borderRadius: 18, background: "#fff", boxShadow: "0 10px 30px rgba(15, 23, 42, 0.05)", ...style }}>{children}</section>;
}

function StatusBadge({ status }: { status: PrinterStatus }) {
  const palette: Record<PrinterStatus, CSSProperties> = {
    online: { background: "#dcfce7", color: "#166534", borderColor: "#86efac" },
    offline: { background: "#f1f5f9", color: "#475569", borderColor: "#cbd5e1" },
    checking: { background: "#e0f2fe", color: "#075985", borderColor: "#7dd3fc" },
    connecting: { background: "#fef3c7", color: "#92400e", borderColor: "#fcd34d" },
    needs_check: { background: "#ffedd5", color: "#9a3412", borderColor: "#fdba74" },
    disabled: { background: "#fee2e2", color: "#991b1b", borderColor: "#fca5a5" }
  };
  return <span style={{ display: "inline-flex", alignItems: "center", border: "1px solid", borderRadius: 999, padding: "5px 10px", fontSize: 12, fontWeight: 800, ...palette[status] }}>{statusText[status]}</span>;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

function Button({ variant = "secondary", style, ...props }: ButtonProps) {
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: { background: "#2563eb", color: "#fff", borderColor: "#2563eb" },
    secondary: { background: "#fff", color: "#0f172a", borderColor: "#cbd5e1" },
    danger: { background: "#fff1f2", color: "#be123c", borderColor: "#fecdd3" },
    ghost: { background: "transparent", color: "#2563eb", borderColor: "transparent" }
  };
  return (
    <button
      {...props}
      style={{
        minHeight: 40,
        border: "1px solid",
        borderRadius: 12,
        padding: "9px 14px",
        fontWeight: 800,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.55 : 1,
        ...variants[variant],
        ...style
      }}
    />
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: "grid", gap: 8, color: "#0f172a", fontWeight: 800 }}>
      <span>{label}</span>
      {children}
      {hint ? <small style={{ color: "#64748b", fontWeight: 600 }}>{hint}</small> : null}
    </label>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: 42,
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  padding: "9px 12px",
  outline: "none",
  background: "#fff",
  color: "#0f172a",
  fontWeight: 700
};

export function PrinterConnectionManagerV2() {
  const [printers, setPrinters] = useState<PrinterRow[]>([]);
  const [agents, setAgents] = useState<PrintAgentRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<ConnectionMode>("usb");
  const [printerName, setPrinterName] = useState("POS-COUNTER-01");
  const [branchLabel, setBranchLabel] = useState("สาขาปัจจุบัน");
  const [paperWidth, setPaperWidth] = useState<PrinterPaperWidth>(58);
  const [ipAddress, setIpAddress] = useState("192.168.1.50");
  const [port, setPort] = useState(9100);
  const [agentDeviceCode, setAgentDeviceCode] = useState("POS-COUNTER-01");
  const [bluetoothName, setBluetoothName] = useState("XP-58");
  const [selectedFunctions, setSelectedFunctions] = useState<PrinterFunction[]>(["receipt", "cash_drawer", "reprint"]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<ConnectionMode | "all">("all");
  const [discoveryCandidates, setDiscoveryCandidates] = useState<DiscoveryCandidate[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [printerData, agentData] = await Promise.all([
        fetchApi<PrinterListResponse>(`/api/backoffice/printers?page=${page}&pageSize=${PAGE_SIZE}`),
        fetchApi<AgentListResponse>("/api/backoffice/printers/agents").catch(() => ({ items: [] }))
      ]);
      setPrinters(printerData.items ?? []);
      setPagination(printerData.pagination ?? { page, pageSize: PAGE_SIZE, total: printerData.items?.length ?? 0, totalPages: 1 });
      setAgents(agentData.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลเครื่องพิมพ์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [page]);

  const runDiscovery = useCallback(
    async (showSuccessNotice = true) => {
      setDiscoverLoading(true);
      setError(null);
      try {
        const result = await fetchApi<DiscoveryResponse>(`/api/backoffice/printers/discover?mode=${mode}`);
        setDiscoveryCandidates(result.items ?? []);
        if (showSuccessNotice) setNotice(`ค้นหาอัตโนมัติแล้ว พบ ${result.items?.length ?? 0} รายการในโหมด ${modeText[mode]}`);
      } catch (err) {
        const fallback = buildFallbackCandidates(mode, agents);
        setDiscoveryCandidates(fallback);
        setError(err instanceof Error ? err.message : "ค้นหาอัตโนมัติไม่สำเร็จ ใช้รายการแนะนำสำรองแทน");
      } finally {
        setDiscoverLoading(false);
      }
    },
    [agents, mode]
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void runDiscovery(false);
  }, [runDiscovery]);

  const visibleDiscoveryCandidates = discoveryCandidates.length > 0 ? discoveryCandidates : buildFallbackCandidates(mode, agents);
  const rememberedPrinters = useMemo(() => {
    const rows = printers.map((printer) => ({ printer, mode: inferConnectionMode(printer), functions: readFunctions(printer), status: inferStatus(printer) }));
    return rows.filter((row) => historyFilter === "all" || row.mode === historyFilter).slice(0, 5);
  }, [printers, historyFilter]);

  const onlineAgents = agents.filter((agent) => agent.status === "active").length;
  const drawerReady = printers.some((printer) => printer.enabled && readFunctions(printer).includes("cash_drawer"));

  function toggleFunction(value: PrinterFunction) {
    setSelectedFunctions((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function useCandidate(candidate: DiscoveryCandidate) {
    const candidateFunctions = normalizeFunctions(candidate.functions);
    setMode(candidate.mode);
    setPrinterName(candidate.name);
    setPaperWidth(candidate.paper_width_mm);
    setSelectedFunctions(candidateFunctions.length > 0 ? candidateFunctions : ["receipt"]);
    if (candidate.runtime_device_code) setAgentDeviceCode(candidate.runtime_device_code);
    if (candidate.mode === "bluetooth") setBluetoothName(candidate.name);
    if (candidate.mode === "lan") setPort(9100);
    setNotice(`เลือก ${candidate.name} แล้ว กดบันทึกเพื่อสร้าง/เชื่อมโปรไฟล์เครื่องพิมพ์`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!printerName.trim()) throw new Error("กรุณาระบุชื่อเครื่องพิมพ์");
      if (selectedFunctions.length === 0) throw new Error("กรุณาเลือกเมนู/ฟังก์ชันที่ต้องใช้เครื่องพิมพ์นี้");
      if (mode === "lan" && !ipAddress.trim()) throw new Error("โหมด LAN ต้องระบุ IP address");

      const metadata = buildMetadata({ mode, functions: selectedFunctions, branchLabel, agentDeviceCode, bluetoothName });
      await fetchApi<PrinterRow>("/api/backoffice/printers", {
        method: "POST",
        body: JSON.stringify({
          printer_name: printerName.trim(),
          printer_role: deriveRole(selectedFunctions),
          connection_type: toLegacyConnection(mode),
          ip_address: mode === "lan" ? ipAddress.trim() : null,
          port: mode === "lan" ? port : null,
          paper_width_mm: paperWidth,
          enabled: true,
          metadata
        })
      });

      setNotice("บันทึกเครื่องพิมพ์แล้ว ระบบจะใช้กติกา LAN / USB / Bluetooth ตามที่เลือก");
      await loadData();
      await runDiscovery(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกเครื่องพิมพ์ไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function testPrinter(printerId: string) {
    setNotice(null);
    setError(null);
    try {
      await fetchApi<{ printer_id: string }>("/api/backoffice/printers/test", {
        method: "POST",
        body: JSON.stringify({ printer_id: printerId })
      });
      setNotice("ส่งคำสั่งทดสอบพิมพ์แล้ว โปรดตรวจ Runtime/Agent ว่าสถานะ job เป็น printed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ทดสอบพิมพ์ไม่สำเร็จ");
    }
  }

  async function testDrawer(printer: PrinterRow) {
    setNotice(null);
    setError(null);
    try {
      const metadata = asRecord(printer.metadata);
      const result = await fetchApi<DrawerTestResponse>("/api/backoffice/printers/drawer-test", {
        method: "POST",
        body: JSON.stringify({
          printer_id: printer.id,
          runtime_device_code: readString(metadata.agent_device_code ?? metadata.runtime_device_code ?? metadata.device_code) ?? agentDeviceCode,
          reason: "printer_settings_v2_drawer_test"
        })
      });
      setNotice(`ส่งคำสั่งเปิดลิ้นชักแล้ว job=${result.job_id} event=${result.event_id} status=${result.job_status} (${result.command_queued ? "รอ Runtime/MDM รับงาน" : "ส่งแล้ว"})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ทดสอบลิ้นชักไม่สำเร็จ");
    }
  }

  async function togglePrinter(printer: PrinterRow) {
    setNotice(null);
    setError(null);
    try {
      await fetchApi<PrinterRow>("/api/backoffice/printers", {
        method: "PATCH",
        body: JSON.stringify({
          printer_id: printer.id,
          printer_name: printer.printer_name,
          printer_role: printer.printer_role,
          connection_type: printer.connection_type,
          ip_address: printer.ip_address,
          port: printer.port,
          paper_width_mm: printer.paper_width_mm,
          enabled: !printer.enabled,
          metadata: printer.metadata ?? {}
        })
      });
      setNotice(printer.enabled ? "ยกเลิกการเชื่อมต่อเครื่องพิมพ์แล้ว" : "เปิดใช้งานเครื่องพิมพ์แล้ว");
      await loadData();
      await runDiscovery(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "อัปเดตเครื่องพิมพ์ไม่สำเร็จ");
    }
  }

  async function deletePrinter(printerId: string) {
    if (!confirm("ลบเครื่องพิมพ์นี้ออกจากรายการใช้งาน? ประวัติที่อยู่ใน audit/metadata เดิมจะยังตรวจสอบย้อนหลังได้")) return;
    setNotice(null);
    setError(null);
    try {
      await fetchApi<{ deleted: PrinterRow }>("/api/backoffice/printers", {
        method: "DELETE",
        body: JSON.stringify({ printer_id: printerId })
      });
      setNotice("ลบเครื่องพิมพ์แล้ว");
      await loadData();
      await runDiscovery(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ลบเครื่องพิมพ์ไม่สำเร็จ");
    }
  }

  return (
    <main style={{ display: "grid", gap: 20, color: "#0f172a" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: "0 0 6px", color: "#2563eb", fontWeight: 900 }}>Printer Connection Manager v2</p>
          <h1 style={{ margin: 0, fontSize: 30, letterSpacing: "-0.03em" }}>ตั้งค่าเครื่องพิมพ์</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", maxWidth: 760 }}>
            ตั้งค่าเครื่องพิมพ์แบบง่ายสำหรับเจ้าของร้าน เลือกแค่ LAN / USB / Bluetooth ระบบจะจัดการ Runtime, Local Bridge, Android และ MDM เป็นงานเบื้องหลัง
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button type="button" onClick={() => void runDiscovery()}>ค้นหาอัตโนมัติ</Button>
          <Button type="button" onClick={() => void loadData()}>รีเฟรชสถานะ</Button>
        </div>
      </header>

      <Card style={{ padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 }}>
          {pageSteps.map((step, index) => (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 999, background: index < 4 ? "#2563eb" : "#e2e8f0", color: index < 4 ? "#fff" : "#475569", fontWeight: 900 }}>{index + 1}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{step}</span>
            </div>
          ))}
        </div>
      </Card>

      {notice ? <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 14, padding: 14, fontWeight: 800 }}>{notice}</div> : null}
      {error ? <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 14, padding: 14, fontWeight: 800 }}>{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 18, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 18 }}>
          <Card style={{ padding: 18 }}>
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="สาขา">
                  <input value={branchLabel} onChange={(event) => setBranchLabel(event.target.value)} style={inputStyle} placeholder="สาขาปัจจุบัน" />
                </Field>
                <Field label="ชื่อเครื่องพิมพ์">
                  <input value={printerName} onChange={(event) => setPrinterName(event.target.value)} style={inputStyle} placeholder="เช่น POS-COUNTER-01, KITCHEN-01" />
                </Field>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 18 }}>เลือกโซน / เมนูที่ใช้เครื่องนี้</h2>
                  <span style={{ color: "#64748b", fontSize: 13, fontWeight: 800 }}>1 เครื่องผูกได้หลายเมนู</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                  {functionOptions.map((option) => {
                    const active = selectedFunctions.includes(option.value);
                    return (
                      <button key={option.value} type="button" onClick={() => toggleFunction(option.value)} style={{ textAlign: "left", border: `1px solid ${active ? "#2563eb" : "#dbe7f5"}`, background: active ? "#eff6ff" : "#fff", borderRadius: 14, padding: 12, cursor: "pointer" }}>
                        <strong style={{ display: "block", color: active ? "#1d4ed8" : "#0f172a" }}>{option.label}</strong>
                        <small style={{ color: "#64748b", fontWeight: 700 }}>{option.description}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>เลือกโหมดการเชื่อมต่อ</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                  {modeCards.map((card) => {
                    const active = mode === card.mode;
                    return (
                      <button key={card.mode} type="button" onClick={() => setMode(card.mode)} style={{ border: `1px solid ${active ? "#2563eb" : "#dbe7f5"}`, background: active ? "linear-gradient(180deg, #eff6ff, #ffffff)" : "#fff", borderRadius: 18, padding: 16, display: "grid", gap: 8, textAlign: "left", cursor: "pointer", boxShadow: active ? "0 12px 24px rgba(37, 99, 235, 0.12)" : "none" }}>
                        <span style={{ fontSize: 24 }}>{card.icon}</span>
                        <strong style={{ fontSize: 18, color: active ? "#1d4ed8" : "#0f172a" }}>{card.title}</strong>
                        <span style={{ color: "#334155", fontWeight: 700 }}>{card.description}</span>
                        <small style={{ color: "#64748b", fontWeight: 700 }}>{card.helper}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Card style={{ padding: 16, background: "#f8fbff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>ค้นหาเครื่องพิมพ์อัตโนมัติ</h2>
                    <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                      ดึงข้อมูลจากโปรไฟล์เดิม, Windows Runtime / Local Bridge, Android และ MDM โดยซ่อนค่าขั้นสูงจากผู้ใช้ทั่วไป
                    </p>
                  </div>
                  <Button type="button" variant="primary" disabled={discoverLoading} onClick={() => void runDiscovery()}>{discoverLoading ? "กำลังค้นหา..." : "ค้นหาอัตโนมัติ"}</Button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  {visibleDiscoveryCandidates.map((candidate) => (
                    <div key={candidate.id} style={{ border: "1px solid #dbe7f5", borderRadius: 16, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <strong>{candidate.name}</strong>
                        <StatusBadge status={candidate.status} />
                      </div>
                      <span style={{ color: "#475569", fontSize: 13, fontWeight: 800 }}>{modeText[candidate.mode]} • {candidate.paper_width_mm}mm • {sourceText[candidate.source]}</span>
                      <span style={{ color: "#64748b", fontSize: 13 }}>{candidate.helper}</span>
                      {candidate.runtime_device_code ? <small style={{ color: "#2563eb", fontWeight: 900 }}>เครื่อง: {candidate.runtime_device_code}</small> : null}
                      <Button type="button" onClick={() => useCandidate(candidate)}>ใช้เครื่องนี้</Button>
                    </div>
                  ))}
                </div>
              </Card>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
                <Field label="กระดาษ">
                  <select value={paperWidth} onChange={(event) => setPaperWidth(Number(event.target.value) as PrinterPaperWidth)} style={inputStyle}>
                    <option value={58}>58mm</option>
                    <option value={80}>80mm</option>
                  </select>
                </Field>
                <Field label="รหัสเครื่อง Runtime/Agent" hint="เช่น POS-COUNTER-01">
                  <input value={agentDeviceCode} onChange={(event) => setAgentDeviceCode(event.target.value)} style={inputStyle} />
                </Field>
                <Field label="IP address" hint="ใช้เฉพาะ LAN">
                  <input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} disabled={mode !== "lan"} style={{ ...inputStyle, background: mode === "lan" ? "#fff" : "#f1f5f9" }} />
                </Field>
                <Field label="Port" hint="ค่า ESC/POS ปกติ 9100">
                  <input type="number" value={port} onChange={(event) => setPort(Number(event.target.value))} disabled={mode !== "lan"} style={{ ...inputStyle, background: mode === "lan" ? "#fff" : "#f1f5f9" }} />
                </Field>
              </div>

              {mode === "bluetooth" ? (
                <Field label="ชื่อ Bluetooth" hint="สำหรับ Android/MDM หรือ Bluetooth Bridge">
                  <input value={bluetoothName} onChange={(event) => setBluetoothName(event.target.value)} style={inputStyle} />
                </Field>
              ) : null}

              <div>
                <button type="button" onClick={() => setShowAdvanced((value) => !value)} style={{ border: 0, background: "transparent", color: "#2563eb", fontWeight: 900, cursor: "pointer", padding: 0 }}>
                  {showAdvanced ? "ซ่อน" : "แสดง"} ตั้งค่าขั้นสูง
                </button>
                {showAdvanced ? (
                  <div style={{ marginTop: 12, border: "1px dashed #cbd5e1", borderRadius: 14, padding: 14, background: "#f8fafc", color: "#475569" }}>
                    <strong style={{ color: "#0f172a" }}>ค่าขั้นสูงถูกจัดการอัตโนมัติ</strong>
                    <p style={{ margin: "8px 0 0" }}>
                      โหมด USB/Bluetooth จะบันทึกเป็นงาน Runtime/Agent พร้อม `agent_device_code` ส่วน LAN จะใช้ IP/Port ESC/POS ผู้ใช้ทั่วไปไม่ต้องกรอก secret, UUID, baud rate หรือ metadata JSON
                    </p>
                  </div>
                ) : null}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button type="button" onClick={() => setSelectedFunctions(["receipt", "cash_drawer", "reprint"])}>รีเซ็ตค่าแนะนำ</Button>
                <Button type="submit" variant="primary" disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึกเครื่องพิมพ์"}</Button>
              </div>
            </form>
          </Card>

          <Card style={{ overflow: "hidden" }}>
            <div style={{ padding: 18, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>รายการเครื่องพิมพ์ที่เชื่อมต่อ</h2>
                <p style={{ margin: "6px 0 0", color: "#64748b" }}>แสดงสถานะ สาขา เมนูที่ผูก และจัดการเครื่องพิมพ์ได้จากตารางเดียว</p>
              </div>
              <span style={{ color: "#64748b", fontWeight: 800 }}>ทั้งหมด {pagination.total} เครื่อง</span>
            </div>

            {loading ? (
              <div style={{ padding: 24, color: "#64748b", fontWeight: 800 }}>กำลังโหลดเครื่องพิมพ์...</div>
            ) : printers.length === 0 ? (
              <div style={{ padding: 24, color: "#64748b", fontWeight: 800 }}>ยังไม่มีเครื่องพิมพ์ กดบันทึกเครื่องพิมพ์ด้านบนเพื่อเริ่มใช้งาน</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1020 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", color: "#475569" }}>
                      {["สถานะ", "ชื่อเครื่องพิมพ์", "โหมด", "สาขา", "โซน/เมนูที่เชื่อม", "กระดาษ", "ล่าสุด", "การทำงาน", "จัดการ"].map((heading) => (
                        <th key={heading} style={{ textAlign: "left", padding: "12px 14px", fontSize: 13, borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {printers.map((printer) => {
                      const metadata = asRecord(printer.metadata);
                      const printerMode = inferConnectionMode(printer);
                      const functions = readFunctions(printer);
                      const status = inferStatus(printer);
                      const branchName = readString(metadata.branch_label) ?? branchLabel;
                      const lastOnline = readString(metadata.last_runtime_heartbeat_at ?? metadata.last_seen_at) ?? printer.created_at;
                      return (
                        <tr key={printer.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td style={{ padding: 14 }}><StatusBadge status={status} /></td>
                          <td style={{ padding: 14 }}>
                            <strong>{printer.printer_name}</strong>
                            <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{readString(metadata.brand) ?? "ESC/POS"} {readString(metadata.model) ?? ""}</div>
                          </td>
                          <td style={{ padding: 14, fontWeight: 900 }}>{modeText[printerMode]}</td>
                          <td style={{ padding: 14 }}>{branchName}</td>
                          <td style={{ padding: 14, color: "#334155", fontWeight: 800 }}>{formatFunctions(functions)}</td>
                          <td style={{ padding: 14 }}>{printer.paper_width_mm}mm</td>
                          <td style={{ padding: 14, color: "#64748b" }}>{formatDate(lastOnline)}</td>
                          <td style={{ padding: 14 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <Button type="button" onClick={() => void testPrinter(printer.id)}>พิมพ์ทดสอบ</Button>
                              {functions.includes("cash_drawer") ? <Button type="button" onClick={() => void testDrawer(printer)}>เปิดลิ้นชัก</Button> : null}
                            </div>
                          </td>
                          <td style={{ padding: 14 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <Button type="button" onClick={() => void togglePrinter(printer)}>{printer.enabled ? "ยกเลิกเชื่อมต่อ" : "เปิดใช้งาน"}</Button>
                              <Button type="button" variant="danger" onClick={() => void deletePrinter(printer.id)}>ลบ</Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderTop: "1px solid #e2e8f0" }}>
              <span style={{ color: "#64748b", fontWeight: 800 }}>หน้า {pagination.page} / {Math.max(1, pagination.totalPages)}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <Button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</Button>
                <Button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>ถัดไป</Button>
              </div>
            </div>
          </Card>
        </div>

        <aside style={{ display: "grid", gap: 18 }}>
          <Card style={{ padding: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>การเชื่อมกับระบบ</h2>
            {[
              ["Web App", "พร้อมใช้งาน"],
              ["Windows Runtime", onlineAgents > 0 ? `${onlineAgents} agent ออนไลน์` : "รอ heartbeat"],
              ["Android / MDM", "รองรับ Bluetooth + Drawer"],
              ["Printer", `${printers.length} profile`],
              ["Cash Drawer", drawerReady ? "พร้อมทดสอบ" : "ยังไม่ผูก"]
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: "1px solid #e2e8f0" }}>
                <strong>{label}</strong>
                <span style={{ color: "#2563eb", fontWeight: 900 }}>{value}</span>
              </div>
            ))}
            <p style={{ margin: "12px 0 0", color: "#64748b", fontSize: 13 }}>
              Production ควรใช้ Windows Runtime / Local Bridge เป็นทางหลัก ส่วน Browser Web Serial เป็น fallback/debug เพราะต้องใช้ permission และ user gesture
            </p>
          </Card>

          <Card style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>ประวัติเครื่องที่เคยเชื่อมต่อ</h2>
              <select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value as ConnectionMode | "all")} style={{ ...inputStyle, width: 120, minHeight: 36, padding: "6px 8px" }}>
                <option value="all">ทั้งหมด</option>
                <option value="lan">LAN</option>
                <option value="usb">USB</option>
                <option value="bluetooth">Bluetooth</option>
              </select>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {rememberedPrinters.length === 0 ? <p style={{ color: "#64748b", margin: 0 }}>ยังไม่มีประวัติ</p> : null}
              {rememberedPrinters.map(({ printer, mode: itemMode, functions }) => (
                <button key={printer.id} type="button" onClick={() => { setMode(itemMode); setPrinterName(printer.printer_name); setPaperWidth(printer.paper_width_mm); setSelectedFunctions(functions); }} style={{ border: "1px solid #dbe7f5", borderRadius: 14, background: "#fff", padding: 12, textAlign: "left", cursor: "pointer" }}>
                  <strong>{printer.printer_name}</strong>
                  <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>{modeText[itemMode]} • {printer.paper_width_mm}mm • {formatFunctions(functions)}</div>
                  <span style={{ display: "inline-block", color: "#2563eb", fontWeight: 900, marginTop: 8 }}>เชื่อมต่ออีกครั้ง</span>
                </button>
              ))}
            </div>
          </Card>

          <Card style={{ padding: 16, background: "#f0fdf4", borderColor: "#bbf7d0" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>กฎสำคัญก่อน Deploy</h2>
            <p style={{ margin: 0, color: "#166534", fontWeight: 800 }}>
              คิวเก่าที่ quarantine แล้วห้าม replay และการปิดงานจริงต้องเห็น `printed` กับ `drawer_kicked` จาก Runtime/Event log
            </p>
          </Card>
        </aside>
      </div>
    </main>
  );
}

export default PrinterConnectionManagerV2;

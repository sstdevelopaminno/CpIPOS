import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { listPrintAgents } from "@/lib/printing/print-agent-service";
import { listPrinterProfiles } from "@/lib/printing/print-service";

type CustomerConnectionMode = "lan" | "usb" | "bluetooth";
type DiscoveryStatus = "online" | "offline" | "checking" | "connecting" | "needs_check" | "disabled";

type DiscoveryCandidate = {
  id: string;
  name: string;
  mode: CustomerConnectionMode;
  paper_width_mm: 58 | 80;
  source: "windows_runtime" | "android_mdm" | "configured_profile" | "manual_lan";
  status: DiscoveryStatus;
  runtime_device_code: string | null;
  printer_profile_id: string | null;
  functions: string[];
  capabilities: Record<string, boolean>;
  helper: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTextArray(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function normalizeMode(value: unknown, fallback: CustomerConnectionMode): CustomerConnectionMode {
  const text = readText(value);
  if (text === "lan" || text === "usb" || text === "bluetooth") return text;
  return fallback;
}

function normalizeProfileMode(connectionType: string, metadata: Record<string, unknown>): CustomerConnectionMode {
  const saved = normalizeMode(metadata.user_connection_mode ?? metadata.connection_mode ?? metadata.transport_mode, "usb");
  if (saved) return saved;
  if (connectionType === "NETWORK_ESC_POS") return "lan";
  if (connectionType === "BLUETOOTH_BRIDGE") return "bluetooth";
  return "usb";
}

function normalizeFunctions(role: string, metadata: Record<string, unknown>) {
  const saved = readTextArray(metadata.print_functions);
  if (saved.length > 0) return saved;
  if (role === "kitchen") return ["kitchen"];
  if (role === "report") return ["shift_report"];
  return ["receipt"];
}

function normalizeStatus(enabled: boolean, metadata: Record<string, unknown>): DiscoveryStatus {
  if (!enabled) return "disabled";
  const saved = readText(metadata.status ?? metadata.runtime_status ?? metadata.health_status);
  if (saved === "online" || saved === "offline" || saved === "checking" || saved === "connecting" || saved === "needs_check") return saved;
  if (metadata.last_runtime_heartbeat_at || metadata.last_seen_at) return "online";
  return "checking";
}

function isRequestedMode(candidate: DiscoveryCandidate, mode: CustomerConnectionMode | "all") {
  return mode === "all" || candidate.mode === mode;
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    if (auth.branchRole !== "manager" && auth.branchRole !== "owner") {
      return fail("forbidden_role", "Only manager or owner can discover printer settings.", 403);
    }

    const url = new URL(req.url);
    const requestedMode = normalizeMode(url.searchParams.get("mode"), "usb");
    const allModes = url.searchParams.get("mode") === "all";
    const modeFilter: CustomerConnectionMode | "all" = allModes ? "all" : requestedMode;

    const [profiles, agents] = await Promise.all([listPrinterProfiles(auth), listPrintAgents(auth)]);
    const candidates: DiscoveryCandidate[] = [];

    for (const profile of profiles) {
      const metadata = asRecord(profile.metadata);
      const mode = normalizeProfileMode(profile.connection_type, metadata);
      candidates.push({
        id: `profile:${profile.id}`,
        name: profile.printer_name,
        mode,
        paper_width_mm: profile.paper_width_mm,
        source: "configured_profile",
        status: normalizeStatus(profile.enabled, metadata),
        runtime_device_code: readText(metadata.agent_device_code ?? metadata.runtime_device_code ?? metadata.device_code),
        printer_profile_id: profile.id,
        functions: normalizeFunctions(profile.printer_role, metadata),
        capabilities: {
          receipt: normalizeFunctions(profile.printer_role, metadata).includes("receipt"),
          kitchen: normalizeFunctions(profile.printer_role, metadata).includes("kitchen"),
          cash_drawer: normalizeFunctions(profile.printer_role, metadata).includes("cash_drawer") || metadata.cash_drawer_enabled === true
        },
        helper: "โปรไฟล์ที่เคยบันทึกไว้ สามารถกดเชื่อมต่ออีกครั้งหรือแก้ไขเมนูที่ผูกได้"
      });
    }

    for (const agent of agents) {
      const metadata = asRecord(agent.metadata);
      const supportsBluetooth = metadata.android_mdm === true || metadata.supports_bluetooth === true || readText(agent.app_version)?.toLowerCase().includes("android");
      candidates.push({
        id: `agent:${agent.id}`,
        name: agent.agent_name || agent.device_code,
        mode: supportsBluetooth ? "bluetooth" : "usb",
        paper_width_mm: 58,
        source: supportsBluetooth ? "android_mdm" : "windows_runtime",
        status: agent.status === "active" ? "online" : agent.status === "blocked" ? "disabled" : "offline",
        runtime_device_code: agent.device_code,
        printer_profile_id: null,
        functions: ["receipt", "reprint", "cash_drawer"],
        capabilities: {
          receipt: true,
          kitchen: false,
          cash_drawer: true
        },
        helper: supportsBluetooth
          ? "พบ Android/MDM bridge ที่สามารถใช้ Bluetooth printer ได้"
          : "พบ Windows Runtime / Local Bridge ที่เหมาะกับ USB printer และ cash drawer"
      });
    }

    candidates.push({
      id: "manual:lan-escpos",
      name: "เครื่องพิมพ์ LAN / ESC/POS",
      mode: "lan",
      paper_width_mm: 80,
      source: "manual_lan",
      status: "checking",
      runtime_device_code: null,
      printer_profile_id: null,
      functions: ["kitchen"],
      capabilities: {
        receipt: true,
        kitchen: true,
        cash_drawer: false
      },
      helper: "ถ้าเครื่อง LAN ไม่ถูกค้นหาอัตโนมัติ ให้กรอก IP/Port เฉพาะขั้นสูง"
    });

    return ok({
      items: candidates.filter((candidate) => isRequestedMode(candidate, modeFilter)),
      mode: modeFilter,
      note: "Customer-facing modes are LAN, USB and Bluetooth only; Browser Web Serial, Local Bridge, Windows Runtime, Android Bridge and MDM are internal transports."
    });
  } catch (error) {
    return loggedPrintApiFail("printer discovery failed", error, "printer_discovery_failed", "Printer discovery could not be loaded. Please retry.", 400);
  }
}

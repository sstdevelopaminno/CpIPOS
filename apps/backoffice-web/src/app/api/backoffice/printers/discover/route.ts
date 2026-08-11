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

function parseRequestedMode(value: unknown): CustomerConnectionMode | null {
  const text = readText(value);
  if (text === "lan" || text === "usb" || text === "bluetooth") return text;
  return null;
}

function normalizeProfileMode(connectionType: string, metadata: Record<string, unknown>): CustomerConnectionMode {
  const saved = parseRequestedMode(metadata.user_connection_mode ?? metadata.connection_mode ?? metadata.transport_mode);
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

function profileCapabilities(functions: string[], metadata: Record<string, unknown>) {
  return {
    receipt: functions.includes("receipt"),
    kitchen: functions.includes("kitchen") || functions.includes("drink") || functions.includes("bar"),
    cash_drawer: functions.includes("cash_drawer") || metadata.cash_drawer_enabled === true,
    reprint: functions.includes("reprint"),
    shift_report: functions.includes("shift_report"),
    payment_slip: functions.includes("payment_slip")
  };
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    if (auth.branchRole !== "manager" && auth.branchRole !== "owner") {
      return fail("forbidden_role", "Only manager or owner can discover printer settings.", 403);
    }

    const url = new URL(req.url);
    const rawMode = url.searchParams.get("mode");
    const modeFilter: CustomerConnectionMode | "all" = rawMode === "all" ? "all" : parseRequestedMode(rawMode) ?? "usb";

    const [profiles, agents] = await Promise.all([listPrinterProfiles(auth), listPrintAgents(auth)]);
    const candidates: DiscoveryCandidate[] = [];

    for (const profile of profiles) {
      const metadata = asRecord(profile.metadata);
      const mode = normalizeProfileMode(profile.connection_type, metadata);
      const functions = normalizeFunctions(profile.printer_role, metadata);
      candidates.push({
        id: `profile:${profile.id}`,
        name: profile.printer_name,
        mode,
        paper_width_mm: profile.paper_width_mm,
        source: "configured_profile",
        status: normalizeStatus(profile.enabled, metadata),
        runtime_device_code: readText(metadata.agent_device_code ?? metadata.runtime_device_code ?? metadata.device_code),
        printer_profile_id: profile.id,
        functions,
        capabilities: profileCapabilities(functions, metadata),
        helper: profile.enabled
          ? "โปรไฟล์เครื่องพิมพ์ที่ระบบบันทึกไว้แล้ว"
          : "โปรไฟล์ที่ถูกตัดการเชื่อมต่อ สามารถกดเชื่อมต่อใหม่ได้"
      });
    }

    for (const agent of agents) {
      const metadata = asRecord(agent.metadata);
      const appVersion = readText(agent.app_version)?.toLowerCase() ?? "";
      const supportsBluetooth = metadata.android_mdm === true || metadata.supports_bluetooth === true || appVersion.includes("android");
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
          cash_drawer: true,
          reprint: true,
          shift_report: false,
          payment_slip: false
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
        cash_drawer: false,
        reprint: false,
        shift_report: false,
        payment_slip: false
      },
      helper: "Web App ไม่สแกนวง LAN โดยตรง กรุณากรอก IP/Port ของเครื่องพิมพ์ LAN ในตั้งค่าขั้นสูง"
    });

    return ok({
      items: candidates.filter((candidate) => isRequestedMode(candidate, modeFilter)),
      mode: modeFilter,
      note: "ระบบจะแสดงเฉพาะ Runtime / Android / MDM และโปรไฟล์ที่ระบบรู้จักอยู่แล้ว ส่วนเครื่องพิมพ์ LAN ต้องระบุ IP/Port เอง; LAN, USB และ Bluetooth เป็นโหมดที่ผู้ใช้เลือก ส่วน Bridge/Runtime/MDM เป็น transport ภายใน"
    });
  } catch (error) {
    return loggedPrintApiFail("printer discovery failed", error, "printer_discovery_failed", "Printer discovery could not be loaded. Please retry.", 400);
  }
}

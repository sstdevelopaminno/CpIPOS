import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { listPrintAgents } from "@/lib/printing/print-agent-service";
import { getPrinterSettingsAuthContext } from "@/lib/printing/printer-settings-auth";
import { listPrinterProfiles } from "@/lib/printing/print-service";

type CustomerConnectionMode = "lan" | "usb" | "bluetooth";
type DiscoveryStatus = "online" | "offline" | "checking" | "connecting" | "needs_check" | "disabled";
type DiscoveryCandidate = {
  id: string; name: string; mode: CustomerConnectionMode; paper_width_mm: 58 | 80;
  source: "windows_runtime" | "android_mdm" | "configured_profile" | "manual_lan"; status: DiscoveryStatus;
  runtime_device_code: string | null; printer_profile_id: string | null; functions: string[]; capabilities: Record<string, boolean>; helper: string;
};
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function readText(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function readTextArray(value: unknown): string[] { if (typeof value === "string") return [value.trim()].filter(Boolean); if (!Array.isArray(value)) return []; return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean); }
function parseRequestedMode(value: unknown): CustomerConnectionMode | null { const text = readText(value)?.toLowerCase(); return text === "lan" || text === "usb" || text === "bluetooth" ? text : null; }
function normalizeProfileMode(connectionType: string, metadata: Record<string, unknown>): CustomerConnectionMode { const saved = parseRequestedMode(metadata.user_connection_mode ?? metadata.connection_mode ?? metadata.transport_mode); if (saved) return saved; if (connectionType === "NETWORK_ESC_POS") return "lan"; if (connectionType === "BLUETOOTH_BRIDGE") return "bluetooth"; return "usb"; }
function normalizeFunctions(role: string, metadata: Record<string, unknown>) { const saved = readTextArray(metadata.print_functions); if (saved.length > 0) return saved; if (role === "kitchen") return ["kitchen"]; if (role === "report") return ["shift_report"]; return ["receipt"]; }
function normalizeStatus(enabled: boolean, metadata: Record<string, unknown>): DiscoveryStatus { if (!enabled) return "disabled"; const saved = readText(metadata.status ?? metadata.runtime_status ?? metadata.health_status); if (saved === "online" || saved === "offline" || saved === "checking" || saved === "connecting" || saved === "needs_check") return saved; if (metadata.last_runtime_heartbeat_at || metadata.last_seen_at) return "online"; return "checking"; }
function isRequestedMode(candidate: DiscoveryCandidate, mode: CustomerConnectionMode | "all") { return mode === "all" || candidate.mode === mode; }
function profileCapabilities(functions: string[], metadata: Record<string, unknown>) { return { receipt: functions.includes("receipt"), kitchen: functions.includes("kitchen") || functions.includes("drink") || functions.includes("bar"), cash_drawer: functions.includes("cash_drawer") || metadata.cash_drawer_enabled === true, reprint: functions.includes("reprint"), shift_report: functions.includes("shift_report"), payment_slip: functions.includes("payment_slip") }; }
function isAndroidNativeAgent(metadata: Record<string, unknown>, appVersion: string) { const source = readText(metadata.source)?.toLowerCase() ?? ""; const runtime = readText(metadata.runtime)?.toLowerCase() ?? ""; return metadata.native_runtime === true || metadata.android_mdm === true || source.includes("android") || runtime.includes("android") || appVersion.includes("android"); }
function agentModes(metadata: Record<string, unknown>, appVersion: string): CustomerConnectionMode[] { const declared = readTextArray(metadata.transports ?? metadata.supported_transports).map((value) => parseRequestedMode(value)).filter((value): value is CustomerConnectionMode => value !== null); if (declared.length > 0) return Array.from(new Set(declared)); if (isAndroidNativeAgent(metadata, appVersion)) return ["lan", "usb", "bluetooth"]; if (metadata.supports_bluetooth === true) return ["usb", "bluetooth"]; return ["usb"]; }
function agentHelper(mode: CustomerConnectionMode, androidNative: boolean, deviceCode: string) { if (mode === "lan") return androidNative ? `Android Print Agent ${deviceCode} รองรับ LAN — เลือกแล้วกรอก IP/Port ของเครื่องพิมพ์` : `Print Agent ${deviceCode} รองรับ LAN — เลือกแล้วกรอก IP/Port ของเครื่องพิมพ์`; if (mode === "bluetooth") return androidNative ? `Android Print Agent ${deviceCode} รองรับ Bluetooth ที่จับคู่กับเครื่อง POS แล้ว` : `Print Agent ${deviceCode} ประกาศความสามารถ Bluetooth`; return androidNative ? `Android Print Agent ${deviceCode} รองรับ USB printer และ cash drawer` : `Windows Runtime / Local Bridge ${deviceCode} รองรับ USB printer และ cash drawer`; }

export async function GET(req: Request) {
  try {
    const auth = await getPrinterSettingsAuthContext();
    if (auth.branchRole !== "manager" && auth.branchRole !== "owner") return fail("forbidden_role", "Only manager, owner, or Kitchen can discover printer settings.", 403);
    const url = new URL(req.url);
    const rawMode = url.searchParams.get("mode");
    const modeFilter: CustomerConnectionMode | "all" = rawMode === "all" ? "all" : parseRequestedMode(rawMode) ?? "usb";
    const [profiles, agents] = await Promise.all([listPrinterProfiles(auth), listPrintAgents(auth)]);
    const candidates: DiscoveryCandidate[] = [];
    for (const profile of profiles) {
      const metadata = asRecord(profile.metadata); const mode = normalizeProfileMode(profile.connection_type, metadata); const functions = normalizeFunctions(profile.printer_role, metadata);
      candidates.push({ id: `profile:${profile.id}`, name: profile.printer_name, mode, paper_width_mm: profile.paper_width_mm, source: "configured_profile", status: normalizeStatus(profile.enabled, metadata), runtime_device_code: readText(metadata.agent_device_code ?? metadata.runtime_device_code ?? metadata.device_code), printer_profile_id: profile.id, functions, capabilities: profileCapabilities(functions, metadata), helper: profile.enabled ? "โปรไฟล์เครื่องพิมพ์ที่ระบบบันทึกไว้แล้ว" : "โปรไฟล์ที่ถูกตัดการเชื่อมต่อ สามารถกดเชื่อมต่อใหม่ได้" });
    }
    for (const agent of agents) {
      const metadata = asRecord(agent.metadata); const appVersion = readText(agent.app_version)?.toLowerCase() ?? ""; const androidNative = isAndroidNativeAgent(metadata, appVersion);
      for (const agentMode of agentModes(metadata, appVersion)) candidates.push({ id: `agent:${agent.id}:${agentMode}`, name: agent.agent_name || agent.device_code, mode: agentMode, paper_width_mm: 58, source: androidNative ? "android_mdm" : "windows_runtime", status: agent.status === "active" ? "online" : agent.status === "blocked" ? "disabled" : "offline", runtime_device_code: agent.device_code, printer_profile_id: null, functions: ["receipt", "reprint", "cash_drawer"], capabilities: { receipt: true, kitchen: true, cash_drawer: true, reprint: true, shift_report: true, payment_slip: true }, helper: agentHelper(agentMode, androidNative, agent.device_code) });
    }
    candidates.push({ id: "manual:lan-escpos", name: "เครื่องพิมพ์ LAN / ESC/POS", mode: "lan", paper_width_mm: 80, source: "manual_lan", status: "checking", runtime_device_code: null, printer_profile_id: null, functions: ["kitchen"], capabilities: { receipt: true, kitchen: true, cash_drawer: false, reprint: false, shift_report: false, payment_slip: false }, helper: "ถ้าใช้ Print Agent ในร้าน ให้เลือก Runtime/Agent ด้านบน; ถ้าตั้งค่าเองให้กรอก IP/Port ของเครื่องพิมพ์ LAN" });
    return ok({ items: candidates.filter((candidate) => isRequestedMode(candidate, modeFilter)), mode: modeFilter, note: "LAN / USB / Bluetooth คือโหมดที่ผู้ใช้เลือก ส่วน Windows Runtime / Android Print Agent / MDM เป็น transport ภายใน ระบบจะแสดง Agent ในทุกโหมดที่ Agent ประกาศว่ารองรับ" });
  } catch (error) {
    return loggedPrintApiFail("printer discovery failed", error, "printer_discovery_failed", "Printer discovery could not be loaded. Please retry.", 400);
  }
}

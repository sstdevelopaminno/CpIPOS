import { readEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { listPrintAgents } from "@/lib/printing/print-agent-service";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { recordPrinterDeviceActionHistory } from "@/lib/printing/printer-device-registry";
import { getPrinterSettingsAuthContext } from "@/lib/printing/printer-settings-auth";
import { listPrinterProfiles, queueAndProcessTestPrint } from "@/lib/printing/print-service";

type JsonRecord = Record<string, unknown>;
const PRINT_AGENT_FRESH_MS = 5 * 60 * 1000;
function asRecord(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function readStringArray(value: unknown): string[] { if (typeof value === "string") return [value.trim()].filter(Boolean); if (!Array.isArray(value)) return []; return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean); }
function isCloudRuntime() { return readEnv("VERCEL") === "1" || Boolean(readEnv("VERCEL_ENV")); }
function requiresPrintAgent(profile: Awaited<ReturnType<typeof listPrinterProfiles>>[number]) {
  const metadata = asRecord(profile.metadata);
  if (metadata.server_direct_print === true || metadata.process_on_server === true || metadata.print_mode === "server") return false;
  if (profile.connection_type === "LOCAL_BRIDGE" || profile.connection_type === "BLUETOOTH_BRIDGE") return true;
  if (metadata.print_mode === "agent" || metadata.processing_mode === "print_agent" || metadata.queue_only === true || readStringArray(metadata.agent_device_code ?? metadata.agent_device_codes ?? metadata.device_code ?? metadata.device_codes).length > 0 || readStringArray(metadata.assigned_agent_id ?? metadata.assigned_agent_ids ?? metadata.agent_id ?? metadata.agent_ids).length > 0) return true;
  return isCloudRuntime();
}
function agentMatchesProfile(profile: Awaited<ReturnType<typeof listPrinterProfiles>>[number], agent: Awaited<ReturnType<typeof listPrintAgents>>[number]) {
  const metadata = asRecord(profile.metadata);
  const assignedAgentIds = readStringArray(metadata.assigned_agent_id ?? metadata.assigned_agent_ids ?? metadata.agent_id ?? metadata.agent_ids);
  const assignedDeviceCodes = readStringArray(metadata.agent_device_code ?? metadata.agent_device_codes ?? metadata.device_code ?? metadata.device_codes).map((value) => value.toUpperCase());
  if (assignedAgentIds.length > 0) return assignedAgentIds.includes(agent.id);
  if (assignedDeviceCodes.length > 0) return assignedDeviceCodes.includes(agent.device_code.toUpperCase());
  return true;
}
function isFreshAgent(agent: Awaited<ReturnType<typeof listPrintAgents>>[number]) { if (agent.status !== "active" || !agent.last_seen_at) return false; const seenAt = new Date(agent.last_seen_at).getTime(); return Number.isFinite(seenAt) && Date.now() - seenAt <= PRINT_AGENT_FRESH_MS; }
async function assertPrinterReadyForTest(auth: Awaited<ReturnType<typeof getPrinterSettingsAuthContext>>, printerId: string) {
  const profiles = await listPrinterProfiles(auth); const profile = profiles.find((item) => item.id === printerId);
  if (!profile) throw new Error("printer_not_found"); if (!profile.enabled) throw new Error("printer_disabled");
  if (profile.connection_type === "NETWORK_ESC_POS" && !profile.ip_address?.trim()) throw new Error("printer_network_not_configured");
  if (!requiresPrintAgent(profile)) return profile;
  const agents = await listPrintAgents(auth); const compatibleAgents = agents.filter((agent) => agentMatchesProfile(profile, agent));
  if (compatibleAgents.length === 0) throw new Error("printer_agent_not_configured"); if (!compatibleAgents.some(isFreshAgent)) throw new Error("printer_agent_offline"); return profile;
}

export async function POST(req: Request) {
  let auth: Awaited<ReturnType<typeof getPrinterSettingsAuthContext>> | null = null;
  let printerId: string | null = null;
  try {
    auth = await getPrinterSettingsAuthContext();
    const body = await req.json() as { printer_id?: string }; printerId = body.printer_id?.trim() || null;
    if (!printerId) return fail("invalid_printer_id", "printer_id is required.", 422);
    await assertPrinterReadyForTest(auth, printerId);
    const result = await queueAndProcessTestPrint(auth, printerId);
    await recordPrinterDeviceActionHistory(auth, printerId, "test_print_requested", { source: "printer_settings_v3", outcome: "accepted", job_status: result?.status ?? null }).catch(() => undefined);
    const message = result?.status === "printed" ? "พิมพ์ทดสอบสำเร็จแล้ว" : "ส่งงานพิมพ์ทดสอบแล้ว Print Agent ออนไลน์และกำลังรับงาน";
    return ok({ printer_id: printerId, job: result, message });
  } catch (error) {
    if (auth && printerId) await recordPrinterDeviceActionHistory(auth, printerId, "test_print_failed", { source: "printer_settings_v3", outcome: "failed", error_code: error instanceof Error ? error.message : "unknown" }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager, owner, or Kitchen can run test print.", 403);
    if (message === "printer_not_found") return fail("printer_not_found", "ไม่พบเครื่องพิมพ์นี้ในสาขาปัจจุบัน", 404);
    if (message === "printer_disabled") return fail("printer_disabled", "เครื่องพิมพ์นี้ถูกปิดใช้งาน กรุณาเชื่อมต่อใหม่ก่อนทดสอบ", 409);
    if (message === "printer_network_not_configured") return fail("printer_not_configured", "เครื่องพิมพ์ LAN ยังไม่ได้ตั้งค่า IP กรุณาแก้ไข IP/Port ก่อนทดสอบ", 409);
    if (message === "printer_agent_not_configured") return fail("printer_agent_not_configured", "ยังไม่มี Print Agent ที่ตรงกับเครื่อง POS/เครื่องพิมพ์นี้ กรุณาเชื่อมต่อ Runtime หรือ Android Print Agent ก่อนทดสอบ", 503);
    if (message === "printer_agent_offline") return fail("printer_agent_offline", "Print Agent ของเครื่องนี้ออฟไลน์หรือไม่ได้ heartbeat ภายใน 5 นาที กรุณาเปิด/เชื่อมต่อ Print Agent แล้วลองใหม่", 503);
    if (message.includes("timeout")) return fail("print_agent_unavailable", "Print agent or printer did not respond in time.", 504);
    return loggedPrintApiFail("test print failed", error, "test_print_failed", "Test print failed. Please check printer settings and retry.", 400);
  }
}

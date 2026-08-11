import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { listPrintAgents } from "@/lib/printing/print-agent-service";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { listPrinterProfiles } from "@/lib/printing/print-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type RecentPrintJob = {
  id: string;
  printer_id: string | null;
  printer_role: string | null;
  connection_type: string | null;
  status: string | null;
  last_error: string | null;
  printed_at: string | null;
  failed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: JsonRecord | null;
};

type RecentDrawerEvent = {
  id: string;
  printer_profile_id: string | null;
  print_job_id: string | null;
  command_status: string | null;
  physical_status: string | null;
  error_code: string | null;
  trigger_source: string | null;
  created_at: string | null;
  metadata: JsonRecord | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textIncludes(value: unknown, needle: string) {
  const text = readText(value)?.toLowerCase() ?? "";
  return text.includes(needle.toLowerCase());
}

function isTargetPrinterName(name: string, targetPrinter: string) {
  return name.trim().toLowerCase().includes(targetPrinter.trim().toLowerCase());
}

function isTargetRuntimeCode(value: unknown, targetDevice: string) {
  const target = targetDevice.trim().toLowerCase();
  if (!target) return false;
  if (typeof value === "string") return value.trim().toLowerCase() === target;
  if (!Array.isArray(value)) return false;
  return value.some((item) => typeof item === "string" && item.trim().toLowerCase() === target);
}

function profileTargetsRuntime(metadata: JsonRecord, targetDevice: string) {
  return (
    isTargetRuntimeCode(metadata.agent_device_code, targetDevice) ||
    isTargetRuntimeCode(metadata.agent_device_codes, targetDevice) ||
    isTargetRuntimeCode(metadata.runtime_device_code, targetDevice) ||
    isTargetRuntimeCode(metadata.device_code, targetDevice)
  );
}

function jobTargetsRuntime(metadata: JsonRecord, targetDevice: string) {
  return (
    profileTargetsRuntime(metadata, targetDevice) ||
    isTargetRuntimeCode(metadata.runtime_device_code, targetDevice) ||
    isTargetRuntimeCode(metadata.selected_runtime_device_code, targetDevice)
  );
}

function isFreshWithin(value: string | null | undefined, minutes: number) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= minutes * 60_000;
}

function latestIso(values: Array<string | null | undefined>) {
  const sorted = values.filter((value): value is string => Boolean(value)).sort();
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

function drawerEventHasSentEvidence(event: RecentDrawerEvent) {
  const metadata = asRecord(event.metadata);
  return (
    event.command_status === "sent" ||
    event.physical_status === "open" ||
    metadata.print_job_status === "printed" ||
    Boolean(metadata.synced_from_print_agent_at)
  );
}

async function readRecentPrintJobs(auth: Awaited<ReturnType<typeof getAuthContext>>, limit: number) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_jobs")
    .select("id,printer_id,printer_role,connection_type,status,last_error,printed_at,failed_at,created_at,updated_at,metadata")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as RecentPrintJob[];
}

async function readRecentDrawerEvents(auth: Awaited<ReturnType<typeof getAuthContext>>, limit: number) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("cash_drawer_events")
    .select("id,printer_profile_id,print_job_id,command_status,physical_status,error_code,trigger_source,created_at,metadata")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as RecentDrawerEvent[];
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    if (auth.branchRole !== "manager" && auth.branchRole !== "owner") {
      return fail("forbidden_role", "Only manager or owner can view printer smoke status.", 403);
    }

    const url = new URL(req.url);
    const targetDevice = url.searchParams.get("device")?.trim() || "POS-COUNTER-01";
    const targetPrinter = url.searchParams.get("printer")?.trim() || "XP-58";
    const limit = Math.max(5, Math.min(30, Number(url.searchParams.get("limit") ?? 15) || 15));

    const [profiles, agents, recentPrintJobsResult, recentDrawerEventsResult] = await Promise.allSettled([
      listPrinterProfiles(auth),
      listPrintAgents(auth),
      readRecentPrintJobs(auth, limit),
      readRecentDrawerEvents(auth, limit)
    ]);

    const printerProfiles = profiles.status === "fulfilled" ? profiles.value : [];
    const printAgents = agents.status === "fulfilled" ? agents.value : [];
    const recentPrintJobs = recentPrintJobsResult.status === "fulfilled" ? recentPrintJobsResult.value : [];
    const recentDrawerEvents = recentDrawerEventsResult.status === "fulfilled" ? recentDrawerEventsResult.value : [];

    const matchedProfiles = printerProfiles.filter((profile) => {
      const metadata = asRecord(profile.metadata);
      return isTargetPrinterName(profile.printer_name, targetPrinter) || profileTargetsRuntime(metadata, targetDevice);
    });
    const matchedProfileIds = new Set(matchedProfiles.map((profile) => profile.id));
    const matchedAgents = printAgents.filter((agent) => agent.device_code === targetDevice || agent.agent_name === targetDevice || textIncludes(agent.agent_name, targetPrinter));
    const targetJobs = recentPrintJobs.filter((job) => matchedProfileIds.has(String(job.printer_id ?? "")) || jobTargetsRuntime(asRecord(job.metadata), targetDevice));
    const targetDrawerEvents = recentDrawerEvents.filter((event) => matchedProfileIds.has(String(event.printer_profile_id ?? "")) || jobTargetsRuntime(asRecord(event.metadata), targetDevice));

    const latestAgentSeenAt = latestIso(matchedAgents.map((agent) => agent.last_seen_at));
    const hasFreshRuntimeHeartbeat = matchedAgents.some((agent) => agent.status === "active" && isFreshWithin(agent.last_seen_at, 10));
    const hasPrintedReceipt = targetJobs.some((job) => job.status === "printed" && job.printer_role === "receipt");
    const hasDrawerEvent = targetDrawerEvents.some(drawerEventHasSentEvidence);
    const hasQuarantineReplay = [...targetJobs, ...targetDrawerEvents].some((row) => asRecord(row.metadata).quarantine_replay_allowed === true);

    return ok({
      target: {
        device_code: targetDevice,
        printer_name: targetPrinter,
        required_runtime_version: "0.1.8"
      },
      runtime: {
        matched_agents: matchedAgents,
        latest_seen_at: latestAgentSeenAt,
        fresh_heartbeat_10m: hasFreshRuntimeHeartbeat,
        runtime_0_1_8_seen: matchedAgents.some((agent) => agent.app_version === "0.1.8")
      },
      printers: {
        matched_profiles: matchedProfiles,
        cash_drawer_enabled: matchedProfiles.some((profile) => {
          const metadata = asRecord(profile.metadata);
          return metadata.cash_drawer_enabled === true || asRecord(metadata.cash_drawer).enabled === true;
        })
      },
      recent: {
        print_jobs: targetJobs,
        drawer_events: targetDrawerEvents,
        source_errors: {
          profiles: profiles.status === "rejected" ? profiles.reason instanceof Error ? profiles.reason.message : String(profiles.reason) : null,
          agents: agents.status === "rejected" ? agents.reason instanceof Error ? agents.reason.message : String(agents.reason) : null,
          print_jobs: recentPrintJobsResult.status === "rejected" ? recentPrintJobsResult.reason instanceof Error ? recentPrintJobsResult.reason.message : String(recentPrintJobsResult.reason) : null,
          drawer_events: recentDrawerEventsResult.status === "rejected" ? recentDrawerEventsResult.reason instanceof Error ? recentDrawerEventsResult.reason.message : String(recentDrawerEventsResult.reason) : null
        }
      },
      acceptance: {
        fresh_runtime_heartbeat: hasFreshRuntimeHeartbeat,
        runtime_0_1_8_seen: matchedAgents.some((agent) => agent.app_version === "0.1.8"),
        xp58_profile_or_runtime_visible: matchedProfiles.length > 0 || matchedAgents.length > 0,
        receipt_printed_seen: hasPrintedReceipt,
        drawer_event_seen: hasDrawerEvent,
        quarantine_replay_allowed: false,
        quarantine_replay_detected: hasQuarantineReplay,
        ready_to_close: hasFreshRuntimeHeartbeat && hasPrintedReceipt && hasDrawerEvent && !hasQuarantineReplay
      },
      note: "This status endpoint is read-only. It checks fresh Printer/Runtime/MDM evidence and never replays quarantined print jobs."
    });
  } catch (error) {
    return loggedPrintApiFail("printer mdm smoke status failed", error, "printer_mdm_smoke_status_failed", "Printer MDM smoke status could not be loaded. Please retry.", 400);
  }
}

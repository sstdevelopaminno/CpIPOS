import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type AgentLike = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
};

type PrintJobLike = {
  id: string;
  printer_id?: string | null;
  status?: string | null;
  metadata?: JsonRecord | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isDrawerJob(job: PrintJobLike) {
  const metadata = asRecord(job.metadata);
  const command = readText(metadata.command ?? metadata.action)?.toLowerCase().replace(/-/g, "_");
  return Boolean(readText(metadata.cash_drawer_event_id)) || command === "open_cash_drawer" || command === "cash_drawer_open" || command === "drawer_open";
}

async function updateDrawerEvent(
  agent: AgentLike,
  job: PrintJobLike,
  patch: {
    commandStatus: "sent" | "failed";
    physicalStatus: "unknown" | "unsupported" | "offline";
    errorCode?: string | null;
    providerJobId?: string | null;
    bytesSent?: number | null;
    ackMetadata?: JsonRecord | null;
  }
) {
  if (!isDrawerJob(job)) return null;

  const metadata = asRecord(job.metadata);
  const eventId = readText(metadata.cash_drawer_event_id);
  if (!eventId) return null;

  const supabase = getSupabaseServiceClient();
  const nextMetadata: JsonRecord = {
    ...metadata,
    print_agent_id: agent.id,
    print_agent_device_code: agent.device_code,
    print_job_id: job.id,
    print_job_status: job.status ?? null,
    provider_job_id: patch.providerJobId ?? null,
    bytes_sent: patch.bytesSent ?? null,
    agent_metadata: patch.ackMetadata ?? null,
    synced_from_print_agent_at: new Date().toISOString(),
    quarantine_replay_allowed: false
  };

  const { data, error } = await supabase
    .from("cash_drawer_events")
    .update({
      print_job_id: job.id,
      command_status: patch.commandStatus,
      physical_status: patch.physicalStatus,
      error_code: patch.errorCode ?? null,
      metadata: nextMetadata
    })
    .eq("id", eventId)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function markDrawerEventSentByPrintAgent(
  agent: AgentLike,
  job: PrintJobLike,
  input: { providerJobId?: string | null; bytesSent?: number | null; metadata?: JsonRecord | null } = {}
) {
  const jobMetadata = asRecord(job.metadata);
  return updateDrawerEvent(agent, job, {
    commandStatus: "sent",
    physicalStatus: jobMetadata.drawer_status_supported === true ? "unknown" : "unsupported",
    errorCode: null,
    providerJobId: input.providerJobId ?? null,
    bytesSent: input.bytesSent ?? null,
    ackMetadata: input.metadata ?? null
  });
}

export async function markDrawerEventFailedByPrintAgent(
  agent: AgentLike,
  job: PrintJobLike,
  input: { errorCode?: string | null; metadata?: JsonRecord | null } = {}
) {
  return updateDrawerEvent(agent, job, {
    commandStatus: "failed",
    physicalStatus: "offline",
    errorCode: input.errorCode ?? "print_agent_drawer_failed",
    ackMetadata: input.metadata ?? null
  });
}

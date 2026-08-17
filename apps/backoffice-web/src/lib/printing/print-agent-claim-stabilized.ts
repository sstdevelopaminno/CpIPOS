import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { getPrintExecutionDataPlaneClient } from "@/lib/printing/print-execution-data-plane";

type JsonRecord = Record<string, unknown>;

type PrintAgentForClaim = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  app_version: string | null;
};

type PrinterProfileRow = {
  id: string;
  printer_name: string;
  printer_role: "receipt" | "kitchen" | "report";
  connection_type: string;
  ip_address: string | null;
  port: number | null;
  paper_width_mm: 58 | 80;
  enabled: boolean;
  metadata: JsonRecord;
};

type AgentJobRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  order_id: string | null;
  printer_id: string | null;
  printer_role: "receipt" | "kitchen" | "report";
  connection_type: string;
  status: "pending" | "printing" | "printed" | "failed" | "retrying";
  payload_text: string;
  payload_json: JsonRecord;
  retry_count: number;
  max_retry_count: number;
  last_error: string | null;
  metadata: JsonRecord;
  created_at: string;
  claimed_by_agent_id: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  agent_attempt_id: string | null;
  agent_error_code: string | null;
  printer_profiles: null | PrinterProfileRow | PrinterProfileRow[];
};

type ClaimedAgentJobRow = AgentJobRow & { agent_attempt_id: string };

type CachedPrinterIds = {
  expiresAt: number;
  printerIds: string[];
};

const PRINTER_CONFIG_CACHE_MS = 45_000;
const EMPTY_CLAIM_BACKOFF_MS = 250;
const printerIdCache = new Map<string, CachedPrinterIds>();
const emptyClaimBackoff = new Map<string, number>();

const PRINTER_SELECT =
  "id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata";
const AGENT_JOB_SELECT =
  "id,tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,metadata,created_at,claimed_by_agent_id,claimed_at,claim_expires_at,agent_attempt_id,agent_error_code,printer_profiles(id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata)";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function printerMatchesAgent(printer: PrinterProfileRow, agent: PrintAgentForClaim) {
  if (!printer.enabled) return false;
  const metadata = asRecord(printer.metadata);
  const assignedAgentIds = readStringArray(
    metadata.assigned_agent_id ?? metadata.assigned_agent_ids ?? metadata.agent_id ?? metadata.agent_ids
  );
  const assignedDeviceCodes = readStringArray(
    metadata.agent_device_code ?? metadata.agent_device_codes ?? metadata.device_code ?? metadata.device_codes
  ).map((code) => code.toUpperCase());

  if (assignedAgentIds.length > 0) return assignedAgentIds.includes(agent.id);
  if (assignedDeviceCodes.length > 0) return assignedDeviceCodes.includes(agent.device_code.toUpperCase());
  return true;
}

function leaseSeconds(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 45;
  return Math.min(300, Math.max(15, Math.trunc(parsed)));
}

function claimLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(10, Math.max(1, Math.trunc(parsed)));
}

async function eligiblePrinterIds(agent: PrintAgentForClaim) {
  const key = `${agent.tenant_id}:${agent.branch_id}:${agent.id}:${agent.device_code.toUpperCase()}`;
  const now = Date.now();
  const cached = printerIdCache.get(key);
  if (cached && cached.expiresAt > now) return cached.printerIds;

  const { client } = await getPrintExecutionDataPlaneClient(agent.tenant_id);
  const { data, error } = await client
    .from("printer_profiles")
    .select(PRINTER_SELECT)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .eq("enabled", true);
  if (error) throw new Error(error.message);

  const printerIds = ((data ?? []) as PrinterProfileRow[])
    .filter((printer) => printerMatchesAgent(printer, agent))
    .map((printer) => printer.id);
  printerIdCache.set(key, { expiresAt: now + PRINTER_CONFIG_CACHE_MS, printerIds });
  return printerIds;
}

export async function claimPrintJobsStabilized(
  agent: PrintAgentForClaim,
  input: { limit?: unknown; lease_seconds?: unknown; app_version?: string | null }
): Promise<ClaimedAgentJobRow[]> {
  const printerIds = await eligiblePrinterIds(agent);
  if (printerIds.length === 0) return [];

  const backoffKey = `${agent.tenant_id}:${agent.branch_id}:${agent.id}`;
  if ((emptyClaimBackoff.get(backoffKey) ?? 0) > Date.now()) return [];

  const { client } = await getPrintExecutionDataPlaneClient(agent.tenant_id);
  const { data: claimedData, error: claimError } = await client.rpc("claim_print_jobs_v2", {
    p_tenant_id: agent.tenant_id,
    p_branch_id: agent.branch_id,
    p_agent_id: agent.id,
    p_printer_ids: printerIds,
    p_limit: claimLimit(input.limit),
    p_lease_seconds: leaseSeconds(input.lease_seconds)
  });
  if (claimError) throw new Error(claimError.message);

  const claimedRows = (claimedData ?? []) as Array<{ job_id: string; agent_attempt_id: string }>;
  const jobIds = claimedRows.map((row) => row.job_id);
  if (jobIds.length === 0) {
    emptyClaimBackoff.set(backoffKey, Date.now() + EMPTY_CLAIM_BACKOFF_MS);
    return [];
  }
  emptyClaimBackoff.delete(backoffKey);

  // Claim activity is not a heartbeat. Record last_claim_at only when work was actually claimed.
  const nowIso = new Date().toISOString();
  const primary = getPrimarySupabaseServiceClient();
  await primary
    .from("print_agents")
    .update({ last_claim_at: nowIso, app_version: input.app_version ?? agent.app_version })
    .eq("id", agent.id)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id);

  const { data: jobs, error: jobsError } = await client
    .from("print_jobs")
    .select(AGENT_JOB_SELECT)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .in("id", jobIds);
  if (jobsError) throw new Error(jobsError.message);

  const byId = new Map(((jobs ?? []) as unknown as AgentJobRow[]).map((job) => [job.id, job]));
  return claimedRows
    .map((row) => {
      const job = byId.get(row.job_id);
      return job ? { ...job, agent_attempt_id: row.agent_attempt_id } : null;
    })
    .filter((job): job is ClaimedAgentJobRow => Boolean(job));
}

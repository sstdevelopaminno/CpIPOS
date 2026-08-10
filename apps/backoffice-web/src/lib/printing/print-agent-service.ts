import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail } from "@/lib/http";
import { getPrimarySupabaseServiceClient, getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getPrintExecutionDataPlaneClient } from "@/lib/printing/print-execution-data-plane";

type JsonRecord = Record<string, unknown>;

type PrintAgentRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_id: string | null;
  device_code: string;
  agent_name: string;
  api_key_hash: string;
  status: "active" | "blocked" | "inactive";
  last_seen_at: string | null;
  last_claim_at: string | null;
  app_version: string | null;
  metadata: JsonRecord;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type SafePrintAgentRow = Omit<PrintAgentRow, "api_key_hash">;

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

type ClaimedAgentJobRow = AgentJobRow & {
  agent_attempt_id: string;
};

const AGENT_SELECT =
  "id,tenant_id,branch_id,device_id,device_code,agent_name,api_key_hash,status,last_seen_at,last_claim_at,app_version,metadata";

const AGENT_JOB_SELECT =
  "id,tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,metadata,created_at,claimed_by_agent_id,claimed_at,claim_expires_at,agent_attempt_id,agent_error_code,printer_profiles(id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata)";

const PRINTER_SELECT =
  "id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata";

function hashAgentKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ensureManagerOrOwner(auth: AuthContext) {
  if (auth.branchRole !== "manager" && auth.branchRole !== "owner") throw new Error("forbidden_role");
}

function toSafeAgent(row: PrintAgentRow): SafePrintAgentRow {
  const { api_key_hash: _apiKeyHash, ...safe } = row;
  return safe;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readBearer(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

export function readAgentKey(req: Request) {
  return req.headers.get("x-print-agent-key")?.trim() || readBearer(req);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function printerMatchesAgent(printer: PrinterProfileRow, agent: PrintAgentRow) {
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

function normalizeAttemptId(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error("print_attempt_id_required");
  return normalized;
}

export function agentAuthFail(error: unknown) {
  const message = error instanceof Error ? error.message : "print_agent_error";
  if (message === "agent_key_required") return fail("agent_key_required", "Print agent key is required.", 401);
  if (message === "agent_unauthorized") return fail("agent_unauthorized", "Print agent is not authorized.", 401);
  if (message === "agent_inactive") return fail("agent_inactive", "Print agent is inactive or blocked.", 403);
  return null;
}

export async function requirePrintAgent(req: Request): Promise<PrintAgentRow> {
  const rawKey = readAgentKey(req);
  if (!rawKey) throw new Error("agent_key_required");
  const keyHash = hashAgentKey(rawKey);
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase.from("print_agents").select(AGENT_SELECT).eq("api_key_hash", keyHash).maybeSingle();
  if (error) throw new Error(error.message);
  const agent = data as PrintAgentRow | null;
  if (!agent || !safeEqual(agent.api_key_hash, keyHash)) throw new Error("agent_unauthorized");
  if (agent.status !== "active") throw new Error("agent_inactive");
  return agent;
}

export async function listPrintAgents(auth: AuthContext): Promise<SafePrintAgentRow[]> {
  ensureManagerOrOwner(auth);
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_agents")
    .select(`${AGENT_SELECT},created_by,created_at,updated_at`)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PrintAgentRow[]).map(toSafeAgent);
}

export async function createPrintAgent(
  auth: AuthContext,
  input: {
    agent_name: string;
    device_code: string;
    device_id?: string | null;
    app_version?: string | null;
    metadata?: JsonRecord | null;
  }
) {
  ensureManagerOrOwner(auth);
  const agentName = input.agent_name.trim();
  const deviceCode = input.device_code.trim().toUpperCase();
  if (!agentName) throw new Error("agent_name_required");
  if (!deviceCode) throw new Error("device_code_required");

  const rawKey = `cpi_pa_${randomBytes(32).toString("base64url")}`;
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_agents")
    .insert({
      tenant_id: auth.tenantId!,
      branch_id: auth.branchId!,
      device_id: input.device_id ?? null,
      device_code: deviceCode,
      agent_name: agentName,
      api_key_hash: hashAgentKey(rawKey),
      status: "active",
      app_version: input.app_version?.trim() || null,
      metadata: asRecord(input.metadata),
      created_by: auth.userId
    })
    .select(`${AGENT_SELECT},created_by,created_at,updated_at`)
    .single();
  if (error) throw new Error(error.message);

  const agent = data as PrintAgentRow;
  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "staff",
    action: "create_print_agent",
    targetTable: "print_agents",
    targetId: agent.id,
    metadata: { agent_name: agent.agent_name, device_code: agent.device_code }
  });

  return { agent: toSafeAgent(agent), agent_key: rawKey };
}

export async function revokePrintAgent(auth: AuthContext, agentId: string, status: "blocked" | "inactive" = "inactive") {
  ensureManagerOrOwner(auth);
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error("agent_id_required");
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_agents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", normalizedAgentId)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .select(`${AGENT_SELECT},created_by,created_at,updated_at`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("agent_not_found");

  const agent = data as PrintAgentRow;
  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "staff",
    action: "revoke_print_agent",
    targetTable: "print_agents",
    targetId: agent.id,
    metadata: { agent_name: agent.agent_name, device_code: agent.device_code, status }
  });
  return toSafeAgent(agent);
}

export async function deletePrintAgent(auth: AuthContext, agentId: string) {
  ensureManagerOrOwner(auth);
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error("agent_id_required");

  const routed = getSupabaseServiceClient();
  await routed
    .from("print_jobs")
    .update({ claimed_by_agent_id: null, claimed_at: null, claim_expires_at: null, agent_attempt_id: null, updated_at: new Date().toISOString() })
    .eq("claimed_by_agent_id", normalizedAgentId)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!);

  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_agents")
    .delete()
    .eq("id", normalizedAgentId)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .select(`${AGENT_SELECT},created_by,created_at,updated_at`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("agent_not_found");

  const agent = data as PrintAgentRow;
  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "staff",
    action: "delete_print_agent",
    targetTable: "print_agents",
    targetId: agent.id,
    metadata: { agent_name: agent.agent_name, device_code: agent.device_code, status: agent.status }
  });
  return toSafeAgent(agent);
}

export async function touchPrintAgent(agent: PrintAgentRow, input: { appVersion?: string | null; metadata?: JsonRecord | null } = {}) {
  const supabase = getPrimarySupabaseServiceClient();
  const now = new Date().toISOString();
  const metadata = { ...asRecord(agent.metadata), ...asRecord(input.metadata), last_heartbeat_at: now };
  const { data, error } = await supabase
    .from("print_agents")
    .update({ last_seen_at: now, app_version: input.appVersion ?? agent.app_version, metadata })
    .eq("id", agent.id)
    .select(AGENT_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as PrintAgentRow;
}

export async function claimPrintJobs(
  agent: PrintAgentRow,
  input: { limit?: unknown; lease_seconds?: unknown; app_version?: string | null }
): Promise<ClaimedAgentJobRow[]> {
  const nowIso = new Date().toISOString();
  const primary = getPrimarySupabaseServiceClient();
  await primary
    .from("print_agents")
    .update({ last_seen_at: nowIso, last_claim_at: nowIso, app_version: input.app_version ?? agent.app_version })
    .eq("id", agent.id)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id);

  const { client } = await getPrintExecutionDataPlaneClient(agent.tenant_id);
  const { data: printerData, error: printerError } = await client
    .from("printer_profiles")
    .select(PRINTER_SELECT)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .eq("enabled", true);
  if (printerError) throw new Error(printerError.message);

  const printerIds = ((printerData ?? []) as PrinterProfileRow[])
    .filter((printer) => printerMatchesAgent(printer, agent))
    .map((printer) => printer.id);
  if (printerIds.length === 0) return [];

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
  if (jobIds.length === 0) return [];

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

export async function acknowledgePrintJob(
  agent: PrintAgentRow,
  jobId: string,
  input: {
    agent_attempt_id: string;
    provider_job_id?: string | null;
    bytes_sent?: number | null;
    metadata?: JsonRecord | null;
  }
) {
  const attemptId = normalizeAttemptId(input.agent_attempt_id);
  const { client } = await getPrintExecutionDataPlaneClient(agent.tenant_id);
  const bytesSent = Number(input.bytes_sent);
  const { error } = await client.rpc("ack_print_job_v2", {
    p_tenant_id: agent.tenant_id,
    p_branch_id: agent.branch_id,
    p_job_id: jobId,
    p_agent_id: agent.id,
    p_agent_attempt_id: attemptId,
    p_provider_job_id: input.provider_job_id?.trim() || null,
    p_bytes_sent: Number.isFinite(bytesSent) && bytesSent >= 0 ? Math.trunc(bytesSent) : null,
    p_metadata: asRecord(input.metadata)
  });
  if (error) throw new Error(error.message);

  const { data, error: fetchError } = await client
    .from("print_jobs")
    .select(AGENT_JOB_SELECT)
    .eq("id", jobId)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  return data as unknown as AgentJobRow;
}

export async function failPrintJob(
  agent: PrintAgentRow,
  jobId: string,
  input: {
    agent_attempt_id: string;
    error_message?: string | null;
    error_code?: string | null;
    retryable?: boolean | null;
    metadata?: JsonRecord | null;
  }
) {
  const attemptId = normalizeAttemptId(input.agent_attempt_id);
  const { client } = await getPrintExecutionDataPlaneClient(agent.tenant_id);
  const { error } = await client.rpc("fail_print_job_v2", {
    p_tenant_id: agent.tenant_id,
    p_branch_id: agent.branch_id,
    p_job_id: jobId,
    p_agent_id: agent.id,
    p_agent_attempt_id: attemptId,
    p_error_message: input.error_message?.trim() || null,
    p_error_code: input.error_code?.trim() || null,
    p_retryable: input.retryable !== false,
    p_metadata: asRecord(input.metadata)
  });
  if (error) throw new Error(error.message);

  const { data, error: fetchError } = await client
    .from("print_jobs")
    .select(AGENT_JOB_SELECT)
    .eq("id", jobId)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  return data as unknown as AgentJobRow;
}

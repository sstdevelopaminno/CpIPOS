import { createHash, randomBytes } from "node:crypto";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { claimPrintJobsStabilized } from "@/lib/printing/print-agent-claim-stabilized";
import { acknowledgePrintJob, failPrintJob } from "@/lib/printing/print-agent-service";

type RecordJson = Record<string, unknown>;
type AgentRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_id: string | null;
  device_code: string;
  agent_name: string;
  api_key_hash: string;
  status: "active" | "inactive" | "blocked";
  last_seen_at: string | null;
  last_claim_at: string | null;
  app_version: string | null;
  metadata: RecordJson;
};
type Body = {
  action?: "claim" | "ack" | "fail";
  job_id?: string;
  agent_attempt_id?: string;
  provider_job_id?: string;
  error_code?: string;
  error_message?: string;
};

const AGENT_COLUMNS = "id,tenant_id,branch_id,device_id,device_code,agent_name,api_key_hash,status,last_seen_at,last_claim_at,app_version,metadata";
// POS heartbeat sender reports every five minutes; allow one minute of network jitter.
const HEARTBEAT_MAX_AGE_MS = 360_000;
const PRINT_JOB_MAX_AGE_MS = 150_000;
const VALID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): RecordJson {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordJson : {};
}
function storeNoCache(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(req: Request) {
  try {
    // Cookie-authenticated POS session is the credential. Never return an
    // evergreen print-agent API key to JavaScript, sessionStorage, or logs.
    const origin = req.headers.get("origin");
    if (origin !== new URL(req.url).origin) return storeNoCache(fail("windows_agent_origin_invalid", "Same-origin POS session required.", 403));
    const scope = await requirePosSession();
    const { session } = scope;
    if (!scope.permissions.includes("receipts:view") || !session.device_id || !session.device_code) {
      return storeNoCache(fail("windows_agent_device_required", "An authorized device-bound POS session is required.", 403));
    }
    const body = await req.json().catch(() => null) as Body | null;
    if (!body || !["claim", "ack", "fail"].includes(body.action ?? "")) {
      return storeNoCache(fail("windows_agent_action_invalid", "Invalid Windows print agent action.", 422));
    }
    const db = getPrimarySupabaseServiceClient();
    const [health, profileResult] = await Promise.all([
      db.from("pos_device_health_latest")
        .select("last_seen_at,runtime_version,peripheral_health")
        .eq("tenant_id", session.tenant_id)
        .eq("branch_id", session.branch_id)
        .eq("pos_device_id", session.device_id)
        .like("runtime_version", "cpipos-windows%")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from("printer_profiles")
        .select("id,metadata")
        .eq("tenant_id", session.tenant_id)
        .eq("branch_id", session.branch_id)
        .eq("enabled", true)
    ]);
    if (health.error || profileResult.error) throw new Error(health.error?.message ?? profileResult.error?.message);
    const recent = health.data?.last_seen_at && Date.now() - Date.parse(health.data.last_seen_at) <= HEARTBEAT_MAX_AGE_MS;
    const connectedPrinter = asRecord(health.data?.peripheral_health);
    if (!recent || connectedPrinter.selected_printer_valid !== true ||
        typeof connectedPrinter.selected_printer !== "string" ||
        !connectedPrinter.selected_printer.trim()) {
      return storeNoCache(fail("windows_agent_offline", "Windows runtime must be online with a valid installed printer.", 409));
    }
    // An explicit printer assignment is required; an old Android profile
    // cannot be claimed or silently migrated to Windows.
    const profiles = (profileResult.data ?? []).filter(row => {
      const metadata = asRecord(row.metadata);
      return metadata.target_runtime === "windows_native" &&
        String(metadata.windows_device_code ?? "").trim().toUpperCase() === session.device_code!.toUpperCase();
    });
    if (profiles.length === 0) return storeNoCache(fail("windows_printer_not_assigned", "Owner must assign a Windows-native printer profile first.", 409));

    const agentName = `Windows Native POS · ${session.device_code}`;
    const lookup = db.from("print_agents").select(AGENT_COLUMNS)
      .eq("tenant_id", session.tenant_id)
      .eq("branch_id", session.branch_id)
      .eq("device_code", session.device_code)
      .eq("agent_name", agentName);
    const existing = await lookup.maybeSingle<AgentRow>();
    if (existing.error) throw new Error(existing.error.message);
    let agent = existing.data;
    if (!agent) {
      const rawKey = randomBytes(32).toString("base64url");
      const now = new Date().toISOString();
      const created = await db.from("print_agents").insert({
        tenant_id: session.tenant_id,
        branch_id: session.branch_id,
        device_id: session.device_id,
        device_code: session.device_code,
        agent_name: agentName,
        api_key_hash: createHash("sha256").update(rawKey).digest("hex"),
        status: "active",
        app_version: "windows-native-webpos-0.2.0",
        last_seen_at: now,
        metadata: { runtime: "windows_native_print_agent_v1", source: "windows_webview2_pos_session", device_id: session.device_id }
      }).select(AGENT_COLUMNS).single<AgentRow>();
      if (created.error) {
        // Concurrent WebView2 requests can race on agent-name uniqueness.
        const winner = await db.from("print_agents").select(AGENT_COLUMNS)
          .eq("tenant_id", session.tenant_id).eq("branch_id", session.branch_id)
          .eq("device_code", session.device_code).eq("agent_name", agentName).maybeSingle<AgentRow>();
        if (winner.error || !winner.data) throw new Error(winner.error?.message ?? created.error.message);
        agent = winner.data;
      } else agent = created.data;
    }
    if (!agent || agent.status !== "active" ||
        asRecord(agent.metadata).runtime !== "windows_native_print_agent_v1" ||
        agent.device_id !== session.device_id) {
      return storeNoCache(fail("windows_agent_inactive", "Windows print agent enrollment is not valid.", 403));
    }

    if (body.action === "claim") {
      const jobs = await claimPrintJobsStabilized(agent, {
        limit: 1,
        lease_seconds: 120,
        app_version: "windows-native-webpos-0.2.0"
      });
      const job = jobs[0] ?? null;
      if (!job) return storeNoCache(ok({ jobs: [] }));
      // Never reprint a sale completed while this Windows station was offline.
      // The leased stale job is explicitly parked as failed, not replayed.
      if (!Number.isFinite(Date.parse(job.created_at)) ||
          Date.now() - Date.parse(job.created_at) > PRINT_JOB_MAX_AGE_MS) {
        await failPrintJob(agent, job.id, {
          agent_attempt_id: job.agent_attempt_id,
          retryable: false,
          error_code: "windows_receipt_stale_manual_review_required",
          error_message: "Windows was unavailable; print manually after verifying physical receipts."
        });
        return storeNoCache(ok({ jobs: [], stale_job_held: true }));
      }
      // Only explicit HTML receipts are supported in this Windows agent.
      const metadata = asRecord(job.metadata);
      const payloadJson = asRecord(job.payload_json);
      const html = typeof metadata.payload_html === "string" ? metadata.payload_html : "";
      const orderId = typeof job.order_id === "string" && VALID_ID.test(job.order_id) ? job.order_id : null;
      const orderNo = typeof payloadJson.order_no === "string" ? payloadJson.order_no
        : typeof metadata.order_no === "string" ? metadata.order_no : null;
      // Payment notices use the receipt printer role but are NOT paid-sale receipts.
      // Never reserve a sale receipt deduplication key for an unpaid notice.
      const approvedSaleReceipt = metadata.payload_format === "receipt_html_v1" &&
        metadata.document_type !== "payment_notice" && payloadJson.document_type !== "payment_notice";
      if (job.printer_role !== "receipt" || !approvedSaleReceipt || !orderId || !orderNo?.trim() ||
          !html.trim() || html.length > 250_000 ||
          !profiles.some(profile => profile.id === job.printer_id)) {
        await failPrintJob(agent, job.id, {
          agent_attempt_id: job.agent_attempt_id,
          retryable: false,
          error_code: "windows_receipt_unsupported_payload",
          error_message: "Windows agent supports only approved HTML receipts on assigned printer."
        });
        return storeNoCache(ok({ jobs: [], unsupported_job_held: true }));
      }
      // A too-long receipt must be reviewed, never silently truncated so that
      // totals at the end of the paper disappear while the job is ACKed.
      if (typeof job.payload_text === "string" && job.payload_text.length > 14_000) {
        await failPrintJob(agent, job.id, {
          agent_attempt_id: job.agent_attempt_id,
          retryable: false,
          error_code: "windows_receipt_text_too_long",
          error_message: "Receipt text exceeds the safe print limit; review the full receipt before manual printing."
        });
        return storeNoCache(ok({ jobs: [], oversized_job_held: true }));
      }
      return storeNoCache(ok({
        jobs: [{
          id: job.id,
          order_id: orderId,
          agent_attempt_id: job.agent_attempt_id,
          created_at: job.created_at,
          order_no: orderNo,
          reprint: metadata.reprint === true,
          html,
          text: typeof job.payload_text === "string" ? job.payload_text : null,
          printer_name: connectedPrinter.selected_printer
        }]
      }));
    }

    const jobId = typeof body.job_id === "string" ? body.job_id : "";
    const attemptId = typeof body.agent_attempt_id === "string" ? body.agent_attempt_id : "";
    if (!VALID_ID.test(jobId) || attemptId.length < 6 || attemptId.length > 180) {
      return storeNoCache(fail("windows_attempt_invalid", "Job and attempt ID required.", 422));
    }
    if (body.action === "ack") {
      const job = await acknowledgePrintJob(agent, jobId, {
        agent_attempt_id: attemptId,
        provider_job_id: body.provider_job_id?.slice(0, 120) ?? null,
        metadata: { runtime: "windows_native_print_agent_v1", status: "native_spool_accepted_not_physical" }
      });
      return storeNoCache(ok({ status: job.status }));
    }
    const job = await failPrintJob(agent, jobId, {
      agent_attempt_id: attemptId,
      retryable: false,
      error_code: body.error_code?.slice(0, 80) || "windows_spool_failed_or_unknown",
      error_message: body.error_message?.slice(0, 220) || "Windows print outcome could not be confirmed.",
      metadata: { runtime: "windows_native_print_agent_v1", manual_review_required: true }
    });
    return storeNoCache(ok({ status: job.status }));
  } catch (error) {
    if (error instanceof PosGuardError) return storeNoCache(fail(error.code, error.message, error.status));
    console.error("[windows-print-agent] scoped operation failed", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return storeNoCache(fail("windows_agent_unavailable", "Windows print agent operation unavailable.", 503));
  }
}

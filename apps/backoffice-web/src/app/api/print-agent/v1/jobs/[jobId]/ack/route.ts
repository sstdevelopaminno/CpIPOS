import { fail, ok } from "@/lib/http";
import { markDrawerEventSentByPrintAgent } from "@/lib/printing/drawer-event-agent-sync";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { acknowledgePrintJob, agentAuthFail, requirePrintAgent } from "@/lib/printing/print-agent-service";

type AckPayload = {
  agent_attempt_id?: string | null;
  provider_job_id?: string | null;
  bytes_sent?: number | null;
  metadata?: Record<string, unknown> | null;
};

export async function POST(req: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const agent = await requirePrintAgent(req);
    const { jobId } = await context.params;
    if (!jobId?.trim()) return fail("print_job_id_required", "jobId is required.", 422);
    const body = (await req.json().catch(() => null)) as AckPayload | null;
    const attemptId = body?.agent_attempt_id?.trim() ?? "";
    if (!attemptId) return fail("print_attempt_id_required", "agent_attempt_id is required.", 422);

    const job = await acknowledgePrintJob(agent, jobId, {
      agent_attempt_id: attemptId,
      provider_job_id: body?.provider_job_id ?? null,
      bytes_sent: body?.bytes_sent ?? null,
      metadata: body?.metadata ?? null
    });

    // Drawer commands are queued as ordinary print jobs so Runtime/Local Bridge can execute them.
    // Once the agent ACKs the fresh job, also move the matching drawer event from queued -> sent.
    // This never replays quarantined jobs; it only annotates the newly acknowledged job/event pair.
    try {
      await markDrawerEventSentByPrintAgent(agent, job, {
        providerJobId: body?.provider_job_id ?? null,
        bytesSent: body?.bytes_sent ?? null,
        metadata: body?.metadata ?? null
      });
    } catch (drawerEventError) {
      console.warn("[print-agent] drawer event sync failed after ack", {
        job_id: job.id,
        agent_id: agent.id,
        error: drawerEventError instanceof Error ? drawerEventError.message : String(drawerEventError)
      });
    }

    return ok({ job });
  } catch (error) {
    const authError = agentAuthFail(error);
    if (authError) return authError;
    const message = error instanceof Error ? error.message : "Ack failed.";
    if (message.includes("PRINT_JOB_NOT_FOUND")) return fail("print_job_not_found", "Print job was not found.", 404);
    if (message.includes("PRINT_JOB_ATTEMPT_STALE")) return fail("print_job_attempt_stale", "This print attempt no longer owns the job lease.", 409);
    if (message.includes("PRINT_JOB_ATTEMPT_REQUIRED")) return fail("print_attempt_id_required", "agent_attempt_id is required.", 422);
    return loggedPrintApiFail("ack failed", error, "print_agent_ack_failed", "Print agent could not acknowledge this job. Please retry.");
  }
}

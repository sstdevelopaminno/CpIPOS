import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { agentAuthFail, failPrintJob, requirePrintAgent } from "@/lib/printing/print-agent-service";

type FailPayload = {
  agent_attempt_id?: string | null;
  error_message?: string | null;
  error_code?: string | null;
  retryable?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

export async function POST(req: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const agent = await requirePrintAgent(req);
    const { jobId } = await context.params;
    if (!jobId?.trim()) return fail("print_job_id_required", "jobId is required.", 422);
    const body = (await req.json().catch(() => null)) as FailPayload | null;
    const attemptId = body?.agent_attempt_id?.trim() ?? "";
    if (!attemptId) return fail("print_attempt_id_required", "agent_attempt_id is required.", 422);

    const job = await failPrintJob(agent, jobId, {
      agent_attempt_id: attemptId,
      error_message: body?.error_message ?? null,
      error_code: body?.error_code ?? null,
      retryable: body?.retryable ?? null,
      metadata: body?.metadata ?? null
    });
    return ok({ job });
  } catch (error) {
    const authError = agentAuthFail(error);
    if (authError) return authError;
    const message = error instanceof Error ? error.message : "Fail update failed.";
    if (message.includes("PRINT_JOB_NOT_FOUND")) return fail("print_job_not_found", "Print job was not found.", 404);
    if (message.includes("PRINT_JOB_ATTEMPT_STALE")) return fail("print_job_attempt_stale", "This print attempt no longer owns the job lease.", 409);
    if (message.includes("PRINT_JOB_ATTEMPT_REQUIRED")) return fail("print_attempt_id_required", "agent_attempt_id is required.", 422);
    return loggedPrintApiFail("fail update failed", error, "print_agent_fail_failed", "Print agent could not update this failed job. Please retry.");
  }
}

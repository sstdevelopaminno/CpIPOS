import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { agentAuthFail, failPrintJob, requirePrintAgent } from "@/lib/printing/print-agent-service";

type FailPayload = {
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
    const job = await failPrintJob(agent, jobId, {
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
    if (message === "print_job_not_found") return fail("print_job_not_found", "Print job was not found.", 404);
    if (message === "print_job_not_claimed_by_agent") return fail("print_job_not_claimed_by_agent", "Print job is not claimed by this agent.", 409);
    return loggedPrintApiFail("fail update failed", error, "print_agent_fail_failed", "Print agent could not update this failed job. Please retry.");
  }
}

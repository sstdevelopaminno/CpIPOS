import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { acknowledgePrintJob, agentAuthFail, requirePrintAgent } from "@/lib/printing/print-agent-service";

type AckPayload = {
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
    const job = await acknowledgePrintJob(agent, jobId, {
      provider_job_id: body?.provider_job_id ?? null,
      bytes_sent: body?.bytes_sent ?? null,
      metadata: body?.metadata ?? null
    });
    return ok({ job });
  } catch (error) {
    const authError = agentAuthFail(error);
    if (authError) return authError;
    const message = error instanceof Error ? error.message : "Ack failed.";
    if (message === "print_job_not_found") return fail("print_job_not_found", "Print job was not found.", 404);
    if (message === "print_job_not_claimed_by_agent") return fail("print_job_not_claimed_by_agent", "Print job is not claimed by this agent.", 409);
    return loggedPrintApiFail("ack failed", error, "print_agent_ack_failed", "Print agent could not acknowledge this job. Please retry.");
  }
}

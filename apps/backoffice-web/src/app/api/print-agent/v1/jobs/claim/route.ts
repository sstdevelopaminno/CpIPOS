import { fail, ok } from "@/lib/http";
import { agentAuthFail, claimPrintJobs, requirePrintAgent } from "@/lib/printing/print-agent-service";

type ClaimPayload = {
  limit?: number | null;
  lease_seconds?: number | null;
  app_version?: string | null;
};

export async function POST(req: Request) {
  try {
    const agent = await requirePrintAgent(req);
    const body = (await req.json().catch(() => null)) as ClaimPayload | null;
    const jobs = await claimPrintJobs(agent, {
      limit: body?.limit,
      lease_seconds: body?.lease_seconds,
      app_version: body?.app_version ?? null
    });
    return ok({
      agent_id: agent.id,
      tenant_id: agent.tenant_id,
      branch_id: agent.branch_id,
      device_code: agent.device_code,
      jobs
    });
  } catch (error) {
    const authError = agentAuthFail(error);
    if (authError) return authError;
    return fail("print_agent_claim_failed", error instanceof Error ? error.message : "Claim failed.", 500);
  }
}

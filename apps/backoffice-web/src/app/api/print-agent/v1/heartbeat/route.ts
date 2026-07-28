import { fail, ok } from "@/lib/http";
import { agentAuthFail, requirePrintAgent, touchPrintAgent } from "@/lib/printing/print-agent-service";

type HeartbeatPayload = {
  app_version?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function POST(req: Request) {
  try {
    const agent = await requirePrintAgent(req);
    const body = (await req.json().catch(() => null)) as HeartbeatPayload | null;
    const updated = await touchPrintAgent(agent, {
      appVersion: body?.app_version ?? null,
      metadata: body?.metadata ?? null
    });
    return ok({
      agent: {
        id: updated.id,
        tenant_id: updated.tenant_id,
        branch_id: updated.branch_id,
        device_code: updated.device_code,
        status: updated.status,
        last_seen_at: updated.last_seen_at
      }
    });
  } catch (error) {
    const authError = agentAuthFail(error);
    if (authError) return authError;
    return fail("print_agent_heartbeat_failed", error instanceof Error ? error.message : "Heartbeat failed.", 500);
  }
}

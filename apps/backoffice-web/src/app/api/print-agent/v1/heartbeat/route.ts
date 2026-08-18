import { fail, ok } from "@/lib/http";
import { buildPrintAgentHeartbeatMetadata } from "@/lib/printing/print-agent-heartbeat-metadata";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { agentAuthFail, requirePrintAgent, touchPrintAgent } from "@/lib/printing/print-agent-service";

type HeartbeatPayload = {
  app_version?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function POST(req: Request) {
  try {
    const agent = await requirePrintAgent(req);
    const body = (await req.json().catch(() => null)) as HeartbeatPayload | null;
    const appVersion = body?.app_version?.trim() || agent.app_version;
    const metadata = buildPrintAgentHeartbeatMetadata({
      currentMetadata: agent.metadata,
      heartbeatMetadata: body?.metadata ?? null,
      appVersion,
      isActive: agent.status === "active"
    });
    const updated = await touchPrintAgent(agent, {
      appVersion,
      metadata
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
    return loggedPrintApiFail("heartbeat failed", error, "print_agent_heartbeat_failed", "Print agent heartbeat failed. Please retry.");
  }
}

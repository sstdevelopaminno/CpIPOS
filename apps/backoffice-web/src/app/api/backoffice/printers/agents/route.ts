import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { createPrintAgent, deletePrintAgent, listPrintAgents, revokePrintAgent } from "@/lib/printing/print-agent-service";

type CreateAgentPayload = {
  agent_name?: string | null;
  device_code?: string | null;
  device_id?: string | null;
  app_version?: string | null;
  metadata?: Record<string, unknown> | null;
};

type UpdateAgentPayload = {
  agent_id?: string | null;
  action?: "revoke" | "block" | null;
};

type DeleteAgentPayload = {
  agent_id?: string | null;
};

function mapAgentError(error: unknown, fallbackCode: string) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can manage print agents.", 403);
  if (message === "agent_name_required") return fail("invalid_agent_name", "agent_name is required.", 422);
  if (message === "device_code_required") return fail("invalid_device_code", "device_code is required.", 422);
  if (message === "agent_id_required") return fail("invalid_agent_id", "agent_id is required.", 422);
  if (message === "agent_not_found") return fail("agent_not_found", "Print agent was not found.", 404);
  if (message.includes("duplicate key value")) return fail("agent_conflict", "Print agent already exists for this device and branch.", 409);
  return loggedPrintApiFail("print agent settings failed", error, fallbackCode, "Print agent settings could not be updated. Please retry.", 400);
}

export async function GET() {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const agents = await listPrintAgents(auth);
    return ok({ items: agents });
  } catch (error) {
    return mapAgentError(error, "print_agent_list_failed");
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as CreateAgentPayload;
    const result = await createPrintAgent(auth, {
      agent_name: body.agent_name ?? "",
      device_code: body.device_code ?? "",
      device_id: body.device_id ?? null,
      app_version: body.app_version ?? null,
      metadata: body.metadata ?? {}
    });
    return ok(result, 201);
  } catch (error) {
    return mapAgentError(error, "print_agent_create_failed");
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as UpdateAgentPayload;
    const status = body.action === "block" ? "blocked" : "inactive";
    const agent = await revokePrintAgent(auth, body.agent_id ?? "", status);
    return ok({ agent });
  } catch (error) {
    return mapAgentError(error, "print_agent_update_failed");
  }
}


export async function DELETE(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as DeleteAgentPayload;
    const agent = await deletePrintAgent(auth, body.agent_id ?? "");
    return ok({ agent });
  } catch (error) {
    return mapAgentError(error, "print_agent_delete_failed");
  }
}

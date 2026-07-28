import type { AuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { requirePosSession } from "@/lib/pos-session-guard";
import { hasConfiguredCashDrawer, queueAndProcessCashDrawerOpen } from "@/lib/printing/print-service";

type OpenDrawerPayload = {
  reason?: string | null;
};

function mapDrawerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const guard = error as { code?: unknown; status?: unknown } | null;
  if (typeof guard?.code === "string" && typeof guard?.status === "number") {
    return fail(guard.code, message, guard.status);
  }
  if (message === "permission_denied") return fail("permission_denied", "Only owner or manager can open the cash drawer manually.", 403);
  if (message === "drawer_reason_required") return fail("drawer_reason_required", "reason is required for manual cash drawer opening.", 422);
  if (message === "printer_not_configured") return fail("printer_not_configured", "No enabled receipt printer is configured for this branch.", 422);
  if (message === "drawer_not_configured") return fail("drawer_not_configured", "Cash drawer is not enabled on any receipt printer profile.", 422);
  if (message === "drawer_cooldown") return fail("drawer_cooldown", "Please wait a moment before opening the drawer again.", 429);
  if (message.includes("printer_not_found_or_disabled")) return fail("printer_not_configured", "Selected receipt printer is disabled.", 422);
  if (message.includes("timeout")) return fail("print_agent_unavailable", "Print agent or printer did not respond in time.", 504);
  return fail("drawer_open_failed", message, 500);
}

function buildAuthFromScope(scope: Awaited<ReturnType<typeof requirePosSession>>): AuthContext {
  return {
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole: scope.session.role === "owner" || scope.session.role === "manager" || scope.session.role === "staff" || scope.session.role === "accountant" ? scope.session.role : "staff",
    platformRole: "tenant_user" as const
  };
}

export async function GET() {
  try {
    const scope = await requirePosSession();
    const config = await hasConfiguredCashDrawer(buildAuthFromScope(scope));
    return ok(config);
  } catch (error) {
    return mapDrawerError(error);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requirePosSession();
    const body = (await req.json().catch(() => ({}))) as OpenDrawerPayload;
    const auth = buildAuthFromScope(scope);

    const result = await queueAndProcessCashDrawerOpen(auth, {
      triggerSource: "manual",
      reason: body.reason ?? null,
      sessionId: scope.session.id,
      shiftId: scope.session.shift_id,
      posDeviceId: scope.session.device_id,
      metadata: {
        device_code: scope.session.device_code ?? null,
        physical_status_note: "Command delivery does not prove the drawer physically opened unless status feedback is supported."
      }
    });

    return ok({
      command_sent: true,
      physical_status: result.physical_status,
      printer: result.printer,
      event_id: result.event_id,
      job_id: result.job.id
    });
  } catch (error) {
    return mapDrawerError(error);
  }
}

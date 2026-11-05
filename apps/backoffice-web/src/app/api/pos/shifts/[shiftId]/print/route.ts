import type { AuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { queueRoutedShiftReport } from "@/lib/printing/routed-print-service";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";

type PrintShiftPayload = {
  report_html?: string | null;
  request_id?: string | null;
};

function normalizeBranchRole(role: string): AuthContext["branchRole"] {
  if (role === "owner" || role === "manager" || role === "staff" || role === "accountant") return role;
  return "staff";
}

export async function POST(req: Request, context: { params: Promise<{ shiftId: string }> }) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "shift:join");
    const { shiftId } = await context.params;
    if (!shiftId) return fail("invalid_shift_id", "shiftId is required.", 422);

    const body = (await req.json().catch(() => ({}))) as PrintShiftPayload;
    const requestId = String(body.request_id ?? crypto.randomUUID()).trim().slice(0, 80);
    const reportHtml = String(body.report_html ?? "").trim() || null;

    const auth: AuthContext = {
      userId: scope.session.user_id,
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      branchRole: normalizeBranchRole(scope.session.role),
      platformRole: "tenant_user"
    };

    const jobs = await queueRoutedShiftReport({
      auth,
      shiftId,
      runtimeDeviceCode: scope.session.device_code,
      reportHtml,
      idempotencyKey: `shift-report:${shiftId}:${requestId}`
    });

    if (jobs.length === 0) {
      return fail("shift_report_printer_not_configured", "No routed shift-report or receipt printer is configured for this POS device.", 422);
    }

    return ok({
      queued: true,
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        last_error: job.last_error,
        printed_at: job.printed_at
      }))
    });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    const message = error instanceof Error ? error.message : "Shift report print failed.";
    if (message === "shift_not_found") return fail("shift_not_found", "Shift not found in the current branch.", 404);
    if (message === "shift_report_html_too_large") return fail("shift_report_html_too_large", "Shift report HTML is too large.", 413);
    return fail("shift_report_print_failed", message, 500);
  }
}

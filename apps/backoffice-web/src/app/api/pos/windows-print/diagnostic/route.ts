import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";

type DiagnosticInput = {
  order_no?: unknown;
  stage?: unknown;
  error_message?: unknown;
  reprint?: unknown;
};

function safeText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  try {
    const auth = await getPosApiAuthContext({
      requireBranchScope: true,
      requiredPermission: "receipts:view"
    });
    const body = (await req.json().catch(() => null)) as DiagnosticInput | null;
    const stage = safeText(body?.stage, 48);
    const orderNo = safeText(body?.order_no, 80);
    const message = safeText(body?.error_message, 320);
    if (!["dispatch", "response", "timeout", "validation"].includes(stage)) {
      return fail("invalid_windows_print_stage", "Invalid Windows print diagnostic stage.", 422);
    }
    await appendAuditLog({
      tenantId: auth.tenantId ?? undefined,
      branchId: auth.branchId ?? undefined,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "windows_local_receipt_print_failed",
      targetTable: "print_jobs",
      metadata: {
        order_no: orderNo || null,
        stage,
        error_message: message || "no_message",
        reprint: body?.reprint === true,
        transport: "windows_webview2_native_bridge",
        // These client diagnostics must never contain the per-launch bridge
        // token, receipt HTML, payment details, or device-specific secrets.
        outcome: "client_failed_before_native_spool_ack"
      }
    });
    return ok({ recorded: true });
  } catch {
    return fail("windows_print_diagnostic_failed", "Cannot record print diagnostic.", 403);
  }
}

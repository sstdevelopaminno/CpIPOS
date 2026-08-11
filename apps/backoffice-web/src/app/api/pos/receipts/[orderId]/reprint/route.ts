import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { validateManagerPin } from "@/lib/pin-approval";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { queueRoutedReceiptReprint } from "@/lib/printing/routed-print-service";

type ReprintPayload = {
  manager_pin?: string | null;
  note?: string | null;
  receipt_html?: string | null;
  order_no?: string | null;
};

export async function POST(req: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
    const scope = await requirePosSession();
    await requirePosApiFeature(auth, "receipt_reprint_history");
    const { orderId } = await context.params;
    const body = (await req.json().catch(() => null)) as ReprintPayload | null;
    const managerPin = String(body?.manager_pin ?? "").trim();

    if (!orderId?.trim()) {
      return fail("invalid_order_id", "orderId is required.", 422);
    }
    if (scope.session.tenant_id !== auth.tenantId || scope.session.branch_id !== auth.branchId) {
      return fail("pos_scope_mismatch", "POS session does not match the active tenant/branch.", 403);
    }
    if (auth.branchRole !== "manager" && auth.branchRole !== "owner") {
      return fail("forbidden_role", "Only manager or owner can reprint receipt.", 403);
    }
    if (managerPin.length < 4) {
      return fail("pin_required", "Manager or owner PIN is required.", 422);
    }

    const approval = await validateManagerPin("sales_record_edit", managerPin, {
      tenantId: auth.tenantId!,
      branchId: auth.branchId!
    });

    if (!approval.approved || !approval.approverUserId || !approval.approverRole || approval.approverRole === "it_admin") {
      await appendAuditLog({
        tenantId: auth.tenantId ?? undefined,
        branchId: auth.branchId ?? undefined,
        actorUserId: auth.userId,
        actorRole: auth.branchRole ?? auth.platformRole,
        action: "receipt_reprint_pin_failed",
        targetTable: "orders",
        targetId: orderId,
        metadata: { reason: "pin_rejected" }
      });
      return fail("pin_rejected", "PIN approval rejected.", 403);
    }

    await appendAuditLog({
      tenantId: auth.tenantId ?? undefined,
      branchId: auth.branchId ?? undefined,
      actorUserId: approval.approverUserId,
      actorRole: approval.approverRole,
      action: "receipt_reprint_pin_approved",
      targetTable: "orders",
      targetId: orderId,
      metadata: {
        requested_by: auth.userId,
        note: body?.note ?? null,
        runtime_device_code: scope.session.device_code
      }
    });

    const result = await queueRoutedReceiptReprint({
      auth,
      orderId,
      runtimeDeviceCode: scope.session.device_code,
      receiptHtml: body?.receipt_html?.trim() || null
    });

    await appendAuditLog({
      tenantId: auth.tenantId ?? undefined,
      branchId: auth.branchId ?? undefined,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "receipt_reprinted",
      targetTable: "orders",
      targetId: orderId,
      metadata: {
        approved_by: approval.approverUserId,
        mode: result.mode,
        job_count: result.jobs.length,
        runtime_device_code: scope.session.device_code
      }
    });

    return ok(result);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "forbidden_role") {
      return fail("forbidden_role", "Only manager or owner can reprint receipt.", 403);
    }
    if (message === "order_not_found") {
      return fail("order_not_found", "Order was not found in this branch.", 404);
    }
    if (message === "receipt_printer_not_configured") {
      return fail("receipt_printer_not_configured", "No receipt/reprint printer is configured for this POS or branch.", 422);
    }
    return fail("receipt_reprint_failed", message, 400);
  }
}

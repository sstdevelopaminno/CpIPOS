import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { validateManagerPin } from "@/lib/pin-approval";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { queueAndProcessBluetoothReceiptHtml, reprintOrderReceipt } from "@/lib/printing/print-service";

type ReprintPayload = {
  manager_pin?: string | null;
  note?: string | null;
  receipt_html?: string | null;
  order_no?: string | null;
};

export async function POST(req: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
    await requirePosApiFeature(auth, "receipt_reprint_history");
    const { orderId } = await context.params;
    const body = (await req.json().catch(() => null)) as ReprintPayload | null;
    const managerPin = String(body?.manager_pin ?? "").trim();

    if (!orderId?.trim()) {
      return fail("invalid_order_id", "orderId is required.", 422);
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
        note: body?.note ?? null
      }
    });

    const receiptHtml = body?.receipt_html?.trim() ?? "";
    const orderNo = body?.order_no?.trim() || null;
    const result = receiptHtml
      ? await queueAndProcessBluetoothReceiptHtml(auth, {
          orderId,
          orderNo,
          receiptHtml
        })
          .then((jobs) => ({
            mode: "html_58mm",
            fallback_to_browser_print: false,
            jobs: jobs.map((job) => ({
              id: job.id,
              status: job.status,
              last_error: job.last_error,
              printed_at: job.printed_at
            }))
          }))
          .catch((printError) => {
            const printMessage = printError instanceof Error ? printError.message : "Unknown error";
            if (
              printMessage === "bluetooth_receipt_printer_not_configured" ||
              printMessage.startsWith("BLUETOOTH_BRIDGE request failed")
            ) {
              return {
                mode: "browser_fallback_58mm",
                fallback_to_browser_print: true,
                message: printMessage,
                jobs: []
              };
            }
            throw printError;
          })
      : await reprintOrderReceipt(auth, orderId);

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
        job_count: result.jobs.length
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
    return fail("receipt_reprint_failed", message, 400);
  }
}

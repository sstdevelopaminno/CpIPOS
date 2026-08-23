import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { buildBridgeEnvelope } from "@/lib/printing/bridge-contract";
import { queueAndProcessBluetoothReceiptHtml } from "@/lib/printing/print-service";

type PrintBluetoothReceiptPayload = {
  order_id?: string | null;
  order_no?: string | null;
  receipt_html?: string | null;
};

export async function POST(req: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
    await requirePosApiFeature(auth, "receipt_reprint_history");
    const body = (await req.json()) as PrintBluetoothReceiptPayload;
    const receiptHtml = body.receipt_html?.trim() ?? "";
    if (!receiptHtml) {
      return fail("invalid_receipt_html", "receipt_html is required.", 422);
    }

    const jobs = await queueAndProcessBluetoothReceiptHtml(auth, {
      orderId: body.order_id ?? null,
      orderNo: body.order_no ?? null,
      receiptHtml,
      processImmediately: false
    });

    return ok(
      buildBridgeEnvelope({
        ok: true,
        code: "bluetooth_print_ok",
        message: "Bluetooth print job queued.",
        action: "print",
        data: {
          fallback_to_browser_print: false,
          jobs: jobs.map((job) => ({
            id: job.id,
            status: job.status,
            last_error: job.last_error,
            printed_at: job.printed_at
          }))
        }
      })
    );
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "bluetooth_receipt_html_required") {
      return fail("invalid_receipt_html", "receipt_html is required.", 422);
    }
    if (message === "bluetooth_receipt_html_too_large") {
      return fail("receipt_html_too_large", "receipt_html is too large.", 413);
    }
    if (message === "bluetooth_receipt_printer_not_configured") {
      return ok(
        buildBridgeEnvelope({
          ok: false,
          code: "bluetooth_printer_not_configured",
          message: "No enabled BLUETOOTH_BRIDGE receipt printer found.",
          action: "print",
          data: {
            fallback_to_browser_print: true,
            jobs: []
          }
        })
      );
    }
    if (message === "forbidden_role") {
      return fail("forbidden_role", "Role is not allowed to print.", 403);
    }
    if (message.startsWith("BLUETOOTH_BRIDGE request failed")) {
      return ok(
        buildBridgeEnvelope({
          ok: false,
          code: "bluetooth_bridge_request_failed",
          message,
          action: "print",
          data: {
            fallback_to_browser_print: true,
            jobs: []
          }
        })
      );
    }
    return ok(
      buildBridgeEnvelope({
        ok: false,
        code: "bluetooth_receipt_print_failed",
        message,
        action: "print",
        data: {
          fallback_to_browser_print: true,
          jobs: []
        }
      })
    );
  }
}

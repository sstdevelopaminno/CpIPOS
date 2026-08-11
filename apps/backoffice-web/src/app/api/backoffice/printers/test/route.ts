import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { recordPrinterDeviceActionHistory } from "@/lib/printing/printer-device-registry";
import { queueAndProcessTestPrint } from "@/lib/printing/print-service";

export async function POST(req: Request) {
  let auth: Awaited<ReturnType<typeof getAuthContext>> | null = null;
  let printerId: string | null = null;

  try {
    auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as { printer_id?: string };
    printerId = body.printer_id?.trim() || null;

    if (!printerId) {
      return fail("invalid_printer_id", "printer_id is required.", 422);
    }

    const result = await queueAndProcessTestPrint(auth, printerId);
    await recordPrinterDeviceActionHistory(auth, printerId, "test_print_requested", {
      source: "printer_settings_v3",
      outcome: "accepted"
    }).catch(() => undefined);

    return ok({
      printer_id: printerId,
      job: result
    });
  } catch (error) {
    if (auth && printerId) {
      await recordPrinterDeviceActionHistory(auth, printerId, "test_print_failed", {
        source: "printer_settings_v3",
        outcome: "failed"
      }).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "forbidden_role") {
      return fail("forbidden_role", "Only manager or owner can run test print.", 403);
    }
    if (message === "printer_not_found") {
      return fail("printer_not_found", "Printer is not found in this branch.", 404);
    }
    if (message.includes("timeout")) return fail("print_agent_unavailable", "Print agent or printer did not respond in time.", 504);
    return loggedPrintApiFail("test print failed", error, "test_print_failed", "Test print failed. Please check printer settings and retry.", 400);
  }
}

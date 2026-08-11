import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import {
  openCashDrawerController,
  type CashDrawerConnectionMode
} from "@/lib/printing/cash-drawer-controller-service";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";

type DrawerTestPayload = {
  reason?: string | null;
  mode?: CashDrawerConnectionMode | null;
  printer_id?: string | null;
  runtime_device_code?: string | null;
};

function mapDrawerTestError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can test the cash drawer from printer settings.", 403);
  if (message === "printer_not_configured") return fail("printer_not_configured", "No enabled receipt printer or drawer controller is configured for this branch.", 422);
  if (message === "drawer_not_configured") return fail("drawer_not_configured", "Cash drawer is not enabled on any receipt printer or drawer controller profile.", 422);
  if (message === "drawer_reason_required") return fail("drawer_reason_required", "reason is required for cash drawer testing.", 422);
  if (message === "drawer_cooldown") return fail("drawer_cooldown", "Please wait a moment before testing the drawer again.", 429);
  if (message.includes("timeout")) return fail("print_agent_unavailable", "Print agent, Runtime, drawer controller, or printer did not respond in time.", 504);
  return loggedPrintApiFail("cash drawer settings test failed", error, "drawer_test_failed", "Cash drawer test failed. Please check printer settings and retry.", 400);
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    if (auth.branchRole !== "manager" && auth.branchRole !== "owner") {
      throw new Error("forbidden_role");
    }

    const body = (await req.json().catch(() => ({}))) as DrawerTestPayload;
    const result = await openCashDrawerController(auth, {
      triggerSource: "manual",
      reason: body.reason?.trim() || "printer_settings_v2_drawer_test",
      requestedMode: body.mode ?? null,
      metadata: {
        source: "printer_settings_v2",
        requested_printer_id: body.printer_id ?? null,
        runtime_device_code: body.runtime_device_code ?? null,
        mdm_runtime_test: true,
        quarantine_replay_allowed: false,
        note: "Settings drawer test queues a new drawer command only; it never replays quarantined print jobs."
      }
    });

    return ok({
      command_sent: !result.deferred_to_agent,
      command_queued: result.deferred_to_agent,
      drawer_mode: result.drawer_mode,
      physical_status: result.physical_status,
      printer: result.printer,
      event_id: result.event_id,
      job_id: result.job.id,
      job_status: result.job.status
    });
  } catch (error) {
    return mapDrawerTestError(error);
  }
}

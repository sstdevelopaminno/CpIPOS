import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import {
  KitchenQueueError,
  parseKitchenStatuses,
  transitionKitchenTicketStatus
} from "@/lib/services/kitchen-queue-service";

export async function POST(req: Request, context: { params: Promise<{ ticketId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sale:create" });
    const { ticketId } = await context.params;
    const body = (await req.json().catch(() => null)) as { status?: string } | null;
    if (!ticketId?.trim()) return fail("invalid_kitchen_ticket_id", "ticketId is required.", 422);
    const [status] = parseKitchenStatuses([String(body?.status ?? "")]);
    if (!status) return fail("invalid_kitchen_status", "Kitchen ticket status is required.", 422);

    const ticket = await transitionKitchenTicketStatus({ auth, ticketId: ticketId.trim(), status });
    return ok({ ticket });
  } catch (error) {
    if (error instanceof KitchenQueueError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("kitchen_ticket_status_failed", error instanceof Error ? error.message : "Unknown Kitchen status error.", 400);
  }
}

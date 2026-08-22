import { fail, ok } from "@/lib/http";
import { getKitchenApiAuthContext } from "@/lib/pos-api-auth";
import {
  cancelKitchenTicketItem,
  KitchenQueueError
} from "@/lib/services/kitchen-queue-service";

type Params = { ticketId: string; itemId: string };

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const auth = await getKitchenApiAuthContext({ requiredPermission: "sales:view" });
    const { ticketId, itemId } = await context.params;
    const body = (await req.json().catch(() => null)) as { reason?: string | null } | null;
    const result = await cancelKitchenTicketItem({
      auth,
      ticketId,
      itemId,
      reason: body?.reason ?? null
    });
    return ok({ result });
  } catch (error) {
    if (error instanceof KitchenQueueError) return fail(error.code, error.message, error.status);
    return fail("kitchen_ticket_item_cancel_failed", error instanceof Error ? error.message : "Unknown Kitchen item cancel error.", 400);
  }
}

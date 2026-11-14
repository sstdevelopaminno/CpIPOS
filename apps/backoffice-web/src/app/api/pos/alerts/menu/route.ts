import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { loadPosOperationalMenuCounts } from "@/lib/services/pos-menu-operational-alert-service";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["owner", "manager", "staff", "kitchen"]);
const SERVICE_EVENTS = new Set(["call_staff", "request_checkout"]);

/** One lightweight read for the sales and kitchen navigation badges. */
export async function GET() {
  try {
    const scope = await requirePosSession();
    const role = String(scope.session.role ?? "").toLowerCase();
    if (!ALLOWED_ROLES.has(role)) return fail("forbidden", "POS staff access required.", 403);
    if (role !== "kitchen") requirePermission(scope, "sales:view");
    const counts = await loadPosOperationalMenuCounts({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      includeSales: role !== "kitchen"
    });
    const response = ok(counts);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[pos-menu-alerts] failed to load operational badge counts", error);
    return fail("pos_menu_alerts_unavailable", "Unable to load current POS alerts.", 503);
  }
}

/** A cashier acknowledges a customer's QR waiter/checkout request by
 * selecting the corresponding open table or acknowledging the POS popup.
 * Never modify food order reviews, kitchen tickets, or payments.
 */
export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    const role = String(scope.session.role ?? "").toLowerCase();
    if (!["owner", "manager", "staff"].includes(role)) {
      return fail("forbidden", "Only cashier staff can acknowledge table service.", 403);
    }
    requirePermission(scope, "sales:view");
    const body = (await request.json().catch(() => null)) as { event_id?: string } | null;
    const eventId = String(body?.event_id ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      return fail("invalid_service_event", "A valid QR service event is required.", 422);
    }
    const db = getSupabaseServiceClient();
    const { data: event, error: eventError } = await db.from("table_qr_orders")
      .select("id,table_session_id,event_type,review_status")
      .eq("id", eventId)
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .maybeSingle<{ id: string; table_session_id: string | null; event_type: string; review_status: string | null }>();
    if (eventError) throw eventError;
    if (!event || !SERVICE_EVENTS.has(event.event_type)) {
      return fail("service_request_not_found", "QR service request not found.", 404);
    }
    if (event.review_status === "accepted") return ok({ acknowledged: true });
    if (event.review_status !== null || !event.table_session_id) {
      return fail("service_request_not_pending", "QR service request is not pending.", 409);
    }
    const { data: tableSession, error: tableError } = await db.from("table_bill_sessions")
      .select("id,status,closed_at")
      .eq("id", event.table_session_id)
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .maybeSingle<{ id: string; status: string; closed_at: string | null }>();
    if (tableError) throw tableError;
    if (!tableSession || tableSession.closed_at !== null ||
        !["open", "ordering", "pending_payment"].includes(tableSession.status)) {
      return fail("service_request_closed", "This table is already closed.", 409);
    }
    // 'accepted' is an existing permitted review_status. Restrict updates to
    // service events so food QR order review semantics remain unchanged.
    const { error: updateError } = await db.from("table_qr_orders")
      .update({ review_status: "accepted", reviewed_at: new Date().toISOString(), reviewed_by: scope.session.user_id })
      .eq("id", event.id)
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .in("event_type", ["call_staff", "request_checkout"])
      .is("review_status", null);
    if (updateError) throw updateError;
    const response = ok({ acknowledged: true });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[pos-menu-alerts] unable to acknowledge QR service request", error);
    return fail("service_acknowledgement_failed", "Unable to acknowledge the QR service request.", 503);
  }
}

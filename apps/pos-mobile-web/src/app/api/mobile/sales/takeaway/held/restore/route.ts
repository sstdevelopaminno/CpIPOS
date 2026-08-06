import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

const restoreSchema = z.object({
  orderId: z.string().uuid(),
});

type HeldItemRow = {
  product_id: string | null;
  name: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
};

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "\u0e44\u0e21\u0e48\u0e21\u0e35\u0e2a\u0e34\u0e17\u0e18\u0e34\u0e4c\u0e40\u0e23\u0e35\u0e22\u0e01\u0e1a\u0e34\u0e25\u0e1e\u0e31\u0e01", 403);

    const body = restoreSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1a\u0e34\u0e25\u0e1e\u0e31\u0e01\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07", 422);

    const supabase = createServiceClient();
    const { data: shift, error: shiftError } = await supabase
      .from("shifts")
      .select("id")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("device_code", scope.deviceCode)
      .eq("status", "open")
      .maybeSingle<{ id: string }>();
    if (shiftError) throw new Error(shiftError.message);
    if (!shift) return fail("shift_not_open", "\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e01\u0e30\u0e17\u0e35\u0e48\u0e40\u0e1b\u0e34\u0e14\u0e2d\u0e22\u0e39\u0e48", 409);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,total_amount,grand_total,discount_amount,created_at,updated_at")
      .eq("id", body.data.orderId)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("order_type", "takeaway")
      .eq("status", "draft")
      .contains("metadata", { hold_state: "held" })
      .maybeSingle<{
        id: string;
        order_no: string;
        total_amount: number | null;
        grand_total: number | null;
        discount_amount: number | null;
        created_at: string | null;
        updated_at: string | null;
      }>();
    if (orderError) throw new Error(orderError.message);
    if (!order) return fail("order_not_found", "\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e1e\u0e31\u0e01\u0e17\u0e35\u0e48\u0e40\u0e25\u0e37\u0e2d\u0e01", 404);

    const { data: items, error: itemError } = await supabase
      .from("order_items")
      .select("product_id,name,quantity,unit_price,line_total")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("order_id", order.id);
    if (itemError) throw new Error(itemError.message);

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "draft",
        shift_id: shift.id,
        pos_session_id: scope.sessionId,
        device_code: scope.deviceCode,
        cashier_user_id: scope.userId,
        updated_at: nowIso,
        metadata: {
          source_app: "CpIPOS Mobile",
          source_channel: "mobile_web",
          mode: "takeaway",
          hold_state: "active",
          restored_from: "mobile_held_list",
          restored_by: scope.userId,
          restored_at: nowIso,
        },
      })
      .eq("id", order.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("status", "draft");
    if (updateError) throw new Error(updateError.message);

    await appendMobileAuditLog({
      scope,
      action: "mobile_takeaway_held_bill_restored",
      targetTable: "orders",
      targetId: order.id,
      metadata: {
        order_no: order.order_no,
        total: Number(order.grand_total ?? order.total_amount ?? 0),
        item_count: (items ?? []).length,
      },
      afterData: { status: "draft", hold_state: "active", shift_id: shift.id },
    });

    return ok({
      order: {
        id: order.id,
        orderNo: order.order_no,
        total: Number(order.grand_total ?? order.total_amount ?? 0),
        discount: Number(order.discount_amount ?? 0),
        updatedAt: order.updated_at ?? order.created_at,
        items: ((items ?? []) as HeldItemRow[]).map((item) => ({
          productId: item.product_id,
          name: item.name ?? "-",
          quantity: Number(item.quantity ?? 0),
          unitPrice: Number(item.unit_price ?? 0),
          lineTotal: Number(item.line_total ?? 0),
        })),
      },
    });
  } catch (error) {
    console.error("[takeaway.held.restore]", error);
    return fail("held_restore_failed", "\u0e40\u0e23\u0e35\u0e22\u0e01\u0e1a\u0e34\u0e25\u0e1e\u0e31\u0e01\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08", 503);
  }
}

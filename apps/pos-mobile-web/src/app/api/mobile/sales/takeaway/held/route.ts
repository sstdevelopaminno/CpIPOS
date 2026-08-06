import { fail, ok } from "@/lib/api/response";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HeldOrderRow = {
  id: string;
  order_no: string;
  total_amount: number | null;
  grand_total: number | null;
  discount_amount: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type HeldItemRow = {
  order_id: string;
  product_id: string | null;
  name: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
};

export async function GET() {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์ดูบิลพัก", 403);

    const supabase = createServiceClient();
    const { data: orders, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,total_amount,grand_total,discount_amount,created_at,updated_at")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("order_type", "takeaway")
      .eq("status", "draft")
      .contains("metadata", { hold_state: "held" })
      .order("updated_at", { ascending: false })
      .limit(20);
    if (orderError) throw new Error(orderError.message);

    const orderRows = (orders ?? []) as HeldOrderRow[];
    const orderIds = orderRows.map((order) => order.id);
    let items: HeldItemRow[] = [];
    if (orderIds.length) {
      const { data: itemRows, error: itemError } = await supabase
        .from("order_items")
        .select("order_id,product_id,name,quantity,unit_price,line_total")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .in("order_id", orderIds);
      if (itemError) throw new Error(itemError.message);
      items = (itemRows ?? []) as HeldItemRow[];
    }

    const itemsByOrder = new Map<string, HeldItemRow[]>();
    for (const item of items) {
      const current = itemsByOrder.get(item.order_id) ?? [];
      current.push(item);
      itemsByOrder.set(item.order_id, current);
    }

    return ok({
      orders: orderRows.map((order) => ({
        id: order.id,
        orderNo: order.order_no,
        total: Number(order.grand_total ?? order.total_amount ?? 0),
        discount: Number(order.discount_amount ?? 0),
        updatedAt: order.updated_at ?? order.created_at,
        itemCount: (itemsByOrder.get(order.id) ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
        items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
          productId: item.product_id,
          name: item.name ?? "-",
          quantity: Number(item.quantity ?? 0),
          unitPrice: Number(item.unit_price ?? 0),
          lineTotal: Number(item.line_total ?? 0),
        })),
      })),
    });
  } catch (error) {
    console.error("[takeaway.held]", error);
    return fail("held_list_failed", "โหลดรายการพักบิลไม่สำเร็จ", 503);
  }
}

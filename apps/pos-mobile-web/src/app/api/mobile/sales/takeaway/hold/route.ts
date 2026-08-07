import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const holdSchema = z.object({
  orderId: z.string().uuid(),
  discountMode: z.enum(["percent", "amount"]).optional(),
  discountValue: z.coerce.number().min(0).max(1_000_000).optional(),
  memberId: z.string().uuid().optional(),
  memberPoints: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional(),
  memberStamps: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(999),
  })).min(1).max(100),
});

type HoldResult = {
  order_id: string;
  order_no: string;
  total: number;
};

function holdFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("draft_order_not_found")) return fail("order_not_found", "ไม่พบ draft bill", 404);
  if (message.includes("product_not_available")) return fail("product_not_available", "มีสินค้าบางรายการไม่พร้อมขาย", 409);
  if (message.includes("empty_cart")) return fail("empty_cart", "ยังไม่มีสินค้าในตะกร้า", 422);
  return fail("hold_failed", "พักบิลไม่สำเร็จ กรุณาลองใหม่", 503);
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์พักบิล", 403);

    const body = holdSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลบิลพักไม่ถูกต้อง", 422);

    const supabase = createServiceClient();
    const { data: held, error } = await supabase.rpc("mobile_takeaway_hold_bill", {
      p_tenant_id: scope.tenantId,
      p_branch_id: scope.branchId,
      p_session_id: scope.sessionId,
      p_user_id: scope.userId,
      p_order_id: body.data.orderId,
      p_discount_mode: body.data.discountMode ?? "amount",
      p_discount_value: body.data.discountValue ?? 0,
      p_items: body.data.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
    }).single<HoldResult>();

    if (error) throw new Error(error.message);
    if (!held) throw new Error("draft_order_not_found");

    await appendMobileAuditLog({
      scope,
      action: "mobile_takeaway_bill_held",
      targetTable: "orders",
      targetId: held.order_id,
      metadata: {
        order_no: held.order_no,
        total: Number(held.total ?? 0),
        item_count: body.data.items.length,
        member_id: body.data.memberId ?? null,
        writer: "rpc",
      },
      afterData: { status: "draft", hold_state: "held", total: Number(held.total ?? 0) },
    });

    return ok({
      held: true,
      orderId: held.order_id,
      orderNo: held.order_no,
      total: Number(held.total ?? 0),
      redirectTo: "/sales",
    });
  } catch (error) {
    console.error("[takeaway.hold]", error);
    return holdFailure(error);
  }
}

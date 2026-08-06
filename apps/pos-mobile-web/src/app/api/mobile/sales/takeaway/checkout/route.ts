import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { readMobileSession, requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const checkoutSchema = z.object({
  orderId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "transfer"]),
  cashReceived: z.coerce.number().min(0).max(1_000_000).optional(),
  referenceNo: z.string().trim().max(120).nullable().optional(),
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

type CheckoutBody = z.infer<typeof checkoutSchema>;

type CheckoutResult = {
  order_id: string;
  order_no: string;
  total: number;
  payment_method: "cash" | "transfer";
};

type OrderMemberRow = {
  id: string;
  order_no: string | null;
  grand_total: number | null;
  total_amount: number | null;
  metadata: Record<string, unknown> | null;
};

type MemberBalanceRow = {
  id: string;
  name: string | null;
  phone: string | null;
  points_balance: number | null;
  stamp_balance: number | null;
};

function checkoutRpcFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("shift_not_open")) return fail("shift_not_open", "ยังไม่มีกะที่เปิดอยู่", 409);
  if (message.includes("draft_order_not_found")) return fail("order_not_found", "ไม่พบ draft bill สำหรับชำระเงิน", 404);
  if (message.includes("product_not_available")) return fail("product_not_available", "มีสินค้าบางรายการไม่พร้อมขาย", 409);
  if (message.includes("empty_cart")) return fail("invalid_input", "ไม่มีสินค้าในตะกร้า", 422);
  if (message.includes("cash_not_enough")) return fail("cash_not_enough", "รับเงินสดน้อยกว่ายอดรวม", 422);
  if (message.includes("member_reward_not_enough")) return fail("member_reward_not_enough", "คะแนนหรือแต้มสมาชิกไม่พอสำหรับใช้เป็นส่วนลด", 422);
  if (message.includes("INSUFFICIENT_STOCK")) return fail("insufficient_stock", "สต๊อกวัตถุดิบไม่พอสำหรับขายรายการนี้", 409);
  if (message.includes("INGREDIENT_NOT_FOUND")) return fail("ingredient_not_found", "ไม่พบวัตถุดิบที่ผูกกับสูตรสินค้า", 409);
  return fail("checkout_failed", message ? `บันทึกออเดอร์ไม่สำเร็จ: ${message}` : "บันทึกออเดอร์ไม่สำเร็จ กรุณาลองใหม่", 503);
}

async function recordCheckoutMember(
  supabase: ReturnType<typeof createServiceClient>,
  scope: NonNullable<Awaited<ReturnType<typeof readMobileSession>>>,
  checkout: CheckoutBody,
  result: CheckoutResult,
) {
  if (!checkout.memberId) return;

  const points = Number(checkout.memberPoints ?? 0);
  const stamps = Number(checkout.memberStamps ?? 0);
  if (points === 0 && stamps === 0) return;

  const [{ data: order, error: orderError }, { data: member, error: memberError }] = await Promise.all([
    supabase
      .from("orders")
      .select("id,order_no,grand_total,total_amount,metadata")
      .eq("id", result.order_id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .maybeSingle<OrderMemberRow>(),
    supabase
      .from("mobile_members")
      .select("id,name,phone,points_balance,stamp_balance")
      .eq("id", checkout.memberId)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .maybeSingle<MemberBalanceRow>(),
  ]);

  if (orderError || memberError || !order || !member) return;

  const nowIso = new Date().toISOString();
  const pointsBalance = Number(member.points_balance ?? 0) + points;
  const stampsBalance = Number(member.stamp_balance ?? 0) + stamps;
  if (pointsBalance < 0 || stampsBalance < 0) throw new Error("member_reward_not_enough");
  const amount = Number(order.grand_total ?? order.total_amount ?? result.total ?? 0);

  await supabase
    .from("mobile_members")
    .update({ points_balance: pointsBalance, stamp_balance: stampsBalance, updated_at: nowIso })
    .eq("id", member.id)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId);

  await supabase.from("mobile_member_transactions").insert({
    tenant_id: scope.tenantId,
    branch_id: scope.branchId,
    member_id: member.id,
    order_id: order.id,
    order_no: order.order_no ?? result.order_no,
    amount,
    points_delta: points,
    stamps_delta: stamps,
    created_by: scope.userId,
    created_at: nowIso,
    metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web", mode: "takeaway_checkout" },
  });

  await supabase
    .from("orders")
    .update({
      metadata: {
        ...(order.metadata ?? {}),
        member_id: member.id,
        member_name: member.name,
        member_phone: member.phone,
        member_points_earned: points,
        member_stamps_earned: stamps,
      },
      updated_at: nowIso,
    })
    .eq("id", order.id)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId);
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์ขาย", 403);

    const body = checkoutSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลตะกร้าหรือการชำระเงินไม่ถูกต้อง", 422);

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("mobile_takeaway_checkout_bill", {
      p_tenant_id: scope.tenantId,
      p_branch_id: scope.branchId,
      p_session_id: scope.sessionId,
      p_user_id: scope.userId,
      p_device_code: scope.deviceCode,
      p_order_id: body.data.orderId,
      p_payment_method: body.data.paymentMethod,
      p_cash_received: body.data.paymentMethod === "cash" ? body.data.cashReceived ?? 0 : null,
      p_reference_no: body.data.paymentMethod === "transfer" ? body.data.referenceNo ?? null : null,
      p_discount_mode: body.data.discountMode ?? "amount",
      p_discount_value: body.data.discountValue ?? 0,
      p_items: body.data.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
    }).single<CheckoutResult>();

    if (error) throw new Error(error.message);
    if (!data) return fail("order_not_found", "ไม่พบ draft bill สำหรับชำระเงิน", 404);

    await recordCheckoutMember(supabase, scope, body.data, data);
    await appendMobileAuditLog({
      scope,
      action: "mobile_takeaway_checkout_paid",
      targetTable: "orders",
      targetId: data.order_id,
      metadata: {
        order_no: data.order_no,
        total: Number(data.total ?? 0),
        payment_method: data.payment_method,
        item_count: body.data.items.length,
        member_id: body.data.memberId ?? null,
      },
      afterData: {
        status: "completed",
        total: Number(data.total ?? 0),
        payment_method: data.payment_method,
      },
    });

    return ok({
      orderId: data.order_id,
      orderNo: data.order_no,
      total: Number(data.total ?? 0),
      paymentMethod: data.payment_method,
      redirectTo: "/sales",
    });
  } catch (error) {
    console.error("[takeaway.checkout]", error);
    return checkoutRpcFailure(error);
  }
}

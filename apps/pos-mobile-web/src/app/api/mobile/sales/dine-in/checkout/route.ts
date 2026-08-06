import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { completeDineInPayment, saveDineInDraft } from "@/lib/sales/mobile-dine-in-service";
import { tryDineInCheckoutRpc } from "@/lib/sales/mobile-dine-in-rpc";
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

function checkoutFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("draft_order_not_found")) return fail("order_not_found", "ไม่พบ draft bill ของโต๊ะนี้", 404);
  if (message.includes("table_session_not_active")) return fail("table_session_not_active", "บิลโต๊ะนี้ถูกปิดหรือถูกใช้งานจากอีกเครื่องแล้ว กรุณากลับไปเลือกโต๊ะใหม่", 409);
  if (message.includes("order_already_paid")) return fail("order_already_paid", "บิลนี้ถูกชำระแล้วจากอีกเครื่อง กรุณากลับไปเลือกโต๊ะใหม่", 409);
  if (message.includes("product_not_available")) return fail("product_not_available", "มีสินค้าบางรายการไม่พร้อมขาย", 409);
  if (message.includes("empty_cart")) return fail("empty_cart", "ยังไม่มีสินค้าในตะกร้า", 422);
  if (message.includes("cash_not_enough")) return fail("cash_not_enough", "รับเงินสดน้อยกว่ายอดรวม", 422);
  if (message.includes("INSUFFICIENT_STOCK")) return fail("insufficient_stock", "สต๊อกวัตถุดิบไม่พอสำหรับขายรายการนี้", 409);
  if (message.includes("INGREDIENT_NOT_FOUND")) return fail("ingredient_not_found", "ไม่พบวัตถุดิบที่ผูกกับสูตรสินค้า", 409);
  return fail("checkout_failed", "ชำระบิลโต๊ะไม่สำเร็จ กรุณาลองใหม่", 503);
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์ขาย", 403);

    const body = checkoutSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลตะกร้าหรือการชำระเงินไม่ถูกต้อง", 422);

    const supabase = createServiceClient();
    const rpcAttempt = await tryDineInCheckoutRpc(supabase, scope, body.data);
    if (rpcAttempt.handled) {
      await appendMobileAuditLog({
        scope,
        action: "mobile_dine_in_checkout_paid",
        targetTable: "orders",
        targetId: rpcAttempt.data.order_id,
        metadata: {
          order_no: rpcAttempt.data.order_no,
          total: Number(rpcAttempt.data.total ?? 0),
          payment_method: rpcAttempt.data.payment_method ?? body.data.paymentMethod,
          item_count: body.data.items.length,
          writer: "rpc",
        },
        afterData: { status: "completed", total: Number(rpcAttempt.data.total ?? 0) },
      });

      return ok({
        orderId: rpcAttempt.data.order_id,
        orderNo: rpcAttempt.data.order_no,
        total: Number(rpcAttempt.data.total ?? 0),
        paymentMethod: rpcAttempt.data.payment_method ?? body.data.paymentMethod,
        redirectTo: "/sales/table",
      });
    }

    const saved = await saveDineInDraft(supabase, scope, body.data, {
      checkout_from: "mobile_dine_in",
      member_id: body.data.memberId ?? null,
      member_points_earned: body.data.memberPoints ?? 0,
      member_stamps_earned: body.data.memberStamps ?? 0,
    });
    await completeDineInPayment({
      supabase,
      scope,
      saved,
      paymentMethod: body.data.paymentMethod,
      cashReceived: body.data.paymentMethod === "cash" ? Number(body.data.cashReceived ?? 0) : null,
      referenceNo: body.data.paymentMethod === "transfer" ? body.data.referenceNo ?? null : null,
    });

    await appendMobileAuditLog({
      scope,
      action: "mobile_dine_in_checkout_paid",
      targetTable: "orders",
      targetId: saved.orderId,
      metadata: {
        order_no: saved.orderNo,
        table_id: saved.tableId,
        total: Number(saved.total ?? 0),
        payment_method: body.data.paymentMethod,
        item_count: body.data.items.length,
        writer: "tables_fallback",
      },
      afterData: { status: "completed", total: Number(saved.total ?? 0), table_id: saved.tableId },
    });

    return ok({
      orderId: saved.orderId,
      orderNo: saved.orderNo,
      total: Number(saved.total ?? 0),
      paymentMethod: body.data.paymentMethod,
      redirectTo: "/sales/table",
    });
  } catch (error) {
    console.error("[dine-in.checkout]", error);
    return checkoutFailure(error);
  }
}


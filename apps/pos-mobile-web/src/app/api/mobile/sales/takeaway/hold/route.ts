import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { readMobileSession, requireActiveMobileSession } from "@/lib/auth/session";
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

type HoldBody = z.infer<typeof holdSchema>;
type MobileScope = NonNullable<Awaited<ReturnType<typeof readMobileSession>>>;

type HoldResult = {
  order_id: string;
  order_no: string;
  total: number;
};

type DraftOrderRow = {
  id: string;
  order_no: string;
};

type ProductRow = {
  id: string;
  name: string | null;
  price: number | null;
};

function isMissingRpcSignature(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Could not find the function") || message.includes("schema cache");
}

function holdFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("draft_order_not_found")) return fail("order_not_found", "ไม่พบ draft bill", 404);
  if (message.includes("product_not_available")) return fail("product_not_available", "มีสินค้าบางรายการไม่พร้อมขาย", 409);
  if (message.includes("empty_cart")) return fail("empty_cart", "ยังไม่มีสินค้าในตะกร้า", 422);
  return fail("hold_failed", "พักบิลไม่สำเร็จ กรุณาลองใหม่", 503);
}

async function holdWithRpc(
  supabase: ReturnType<typeof createServiceClient>,
  scope: MobileScope,
  body: HoldBody,
) {
  const commonPayload = {
    p_tenant_id: scope.tenantId,
    p_branch_id: scope.branchId,
    p_session_id: scope.sessionId,
    p_user_id: scope.userId,
    p_order_id: body.orderId,
    p_discount_mode: body.discountMode ?? "amount",
    p_discount_value: body.discountValue ?? 0,
    p_items: body.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
  };

  const firstAttempt = await supabase.rpc("mobile_takeaway_hold_bill", {
    ...commonPayload,
    p_member_id: body.memberId ?? null,
    p_member_points: body.memberPoints ?? 0,
    p_member_stamps: body.memberStamps ?? 0,
  }).single<HoldResult>();

  if (firstAttempt.error && isMissingRpcSignature(firstAttempt.error)) {
    return supabase.rpc("mobile_takeaway_hold_bill", commonPayload).single<HoldResult>();
  }

  return firstAttempt;
}

async function holdWithTables(
  supabase: ReturnType<typeof createServiceClient>,
  scope: MobileScope,
  body: HoldBody,
) {
  const { data: draft, error: draftError } = await supabase
    .from("orders")
    .select("id,order_no")
    .eq("id", body.orderId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("pos_session_id", scope.sessionId)
    .eq("device_code", scope.deviceCode)
    .eq("order_type", "takeaway")
    .eq("status", "draft")
    .maybeSingle<DraftOrderRow>();
  if (draftError) throw new Error(draftError.message);
  if (!draft) throw new Error("draft_order_not_found");

  const productIds = Array.from(new Set(body.items.map((item) => item.productId)));
  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id,name,price")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("is_active", true)
    .in("id", productIds);
  if (productError) throw new Error(productError.message);

  const productsById = new Map(((products ?? []) as ProductRow[]).map((product) => [product.id, product]));
  if (productsById.size !== productIds.length) throw new Error("product_not_available");

  const lines = body.items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) throw new Error("product_not_available");
    const quantity = Number(item.quantity);
    const unitPrice = Number(product.price ?? 0);
    return {
      productId: item.productId,
      name: product.name ?? "-",
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discountValue = Math.max(0, Number(body.discountValue ?? 0));
  const discount = body.discountMode === "percent"
    ? Math.min(subtotal, subtotal * Math.min(discountValue, 100) / 100)
    : Math.min(subtotal, discountValue);
  const total = Math.max(0, subtotal - discount);
  const nowIso = new Date().toISOString();

  const { error: deleteError } = await supabase
    .from("order_items")
    .delete()
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("order_id", draft.id);
  if (deleteError) throw new Error(deleteError.message);

  const { error: itemError } = await supabase.from("order_items").insert(lines.map((line) => ({
    tenant_id: scope.tenantId,
    branch_id: scope.branchId,
    order_id: draft.id,
    product_id: line.productId,
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    line_total: line.lineTotal,
    metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web", mode: "takeaway_hold_fallback" },
  })));
  if (itemError) throw new Error(itemError.message);

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      subtotal,
      discount_amount: discount,
      total_amount: total,
      grand_total: total,
      paid_total: 0,
      updated_at: nowIso,
      metadata: {
        source_app: "CpIPOS Mobile",
        source_channel: "mobile_web",
        mode: "takeaway",
        hold_state: "held",
        held_by: scope.userId,
        held_at: nowIso,
        member_id: body.memberId ?? null,
        member_points_earned: body.memberPoints ?? 0,
        member_stamps_earned: body.memberStamps ?? 0,
        writer: "mobile_takeaway_hold_tables",
      },
    })
    .eq("id", draft.id)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("status", "draft");
  if (updateError) throw new Error(updateError.message);

  return { order_id: draft.id, order_no: draft.order_no, total } satisfies HoldResult;
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์พักบิล", 403);

    const body = holdSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลบิลพักไม่ถูกต้อง", 422);

    const supabase = createServiceClient();
    const rpcResult = await holdWithRpc(supabase, scope, body.data);
    const held = rpcResult.error
      ? await holdWithTables(supabase, scope, body.data)
      : rpcResult.data;

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
        writer: rpcResult.error ? "tables_fallback" : "rpc",
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

import { appendAuditLog } from "@/lib/audit-log";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isTenantPosMenuEnabled } from "@/lib/server/pos-menu-policy-service";
import { executeStockAdjustmentTransaction } from "@/lib/services/stock-transaction-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PriceAction = {
  action: "update_product_price";
  product_id?: unknown;
  new_price?: unknown;
  reason?: unknown;
  approval_id?: unknown;
};

type StockAction = {
  action: "adjust_stock";
  ingredient_id?: unknown;
  quantity_delta?: unknown;
  reason?: unknown;
  approval_id?: unknown;
};

type ActionBody = PriceAction | StockAction;

const ALLOWED_MUTATING_AI_ACTIONS = new Set<ActionBody["action"]>([
  "update_product_price",
  "adjust_stock"
]);

function canExecuteAiAction(branchRole: string | null, _platformRole: string | null) {
  return branchRole === "owner" || branchRole === "manager";
}

function textValue(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function ensureAiPolicy(tenantId: string | null) {
  if (!tenantId) return false;
  return isTenantPosMenuEnabled(tenantId, "main.ai_assistant");
}

async function consumeAiApproval(input: {
  tenantId: string;
  branchId: string;
  userId: string;
  targetId: string;
  approvalId: string;
  action: "sales_record_edit" | "stock_adjustment";
  targetTable: "products" | "ingredients";
}) {
  const supabase = getSupabaseServiceClient();
  const consumedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("manager_pin_approvals")
    .update({ consumed_at: consumedAt })
    .eq("id", input.approvalId)
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId)
    .eq("requested_by", input.userId)
    .eq("action", input.action)
    .eq("target_table", input.targetTable)
    .eq("target_id", input.targetId)
    .gt("expires_at", consumedAt)
    .is("consumed_at", null)
    .select("id,approved_by,expires_at,consumed_at")
    .maybeSingle<{ id: string; approved_by: string; expires_at: string; consumed_at: string }>();

  if (error) throw error;
  return data;
}

export async function POST(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true });
    if (!auth.tenantId || !auth.branchId || !canExecuteAiAction(auth.branchRole, auth.platformRole)) {
      return fail("ai_action_forbidden", "Only Owner or Manager can execute CpiPOS AI actions.", 403);
    }
    if (!(await ensureAiPolicy(auth.tenantId))) {
      return fail("ai_assistant_disabled_by_it", "CpiPOS AI is disabled for this store by IT policy.", 403);
    }

    const rate = await enforceRateLimit({
      namespace: "pos_ai_actions",
      key: `${auth.tenantId}:${auth.userId}`,
      max: 12,
      windowMs: 60_000
    });
    if (!rate.ok) return fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);

    const body = (await request.json().catch(() => null)) as ActionBody | null;
    if (!body || !ALLOWED_MUTATING_AI_ACTIONS.has(body.action)) {
      return fail("invalid_ai_action", "คำสั่งนี้ไม่ได้รับอนุญาตให้ CpiPOS AI ดำเนินการ", 422);
    }

    await requirePosApiFeature(auth, "stock_management");

    if (body.action === "update_product_price") {
      const productId = textValue(body.product_id, 80);
      const approvalId = textValue(body.approval_id, 80);
      const reason = textValue(body.reason, 400) || "CpiPOS AI confirmed price update";
      const newPrice = Number(body.new_price);

      if (!productId || !approvalId || !Number.isFinite(newPrice) || newPrice < 0 || newPrice > 999_999) {
        return fail("invalid_price_action", "Product, new price, and PIN approval are required.", 422);
      }

      const supabase = getSupabaseServiceClient();
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id,name,price,category")
        .eq("tenant_id", auth.tenantId)
        .eq("branch_id", auth.branchId)
        .eq("id", productId)
        .eq("is_active", true)
        .maybeSingle<{ id: string; name: string; price: number; category: string | null }>();
      if (productError) throw productError;
      if (!product) return fail("product_not_found", "Product was not found in this branch.", 404);

      const beforePrice = Number(product.price ?? 0);
      const afterPrice = Number(newPrice.toFixed(2));
      if (beforePrice === afterPrice) {
        return ok({
          action: body.action,
          status: "no_change",
          product_id: product.id,
          product_name: product.name,
          before_price: beforePrice,
          after_price: afterPrice
        });
      }

      const approval = await consumeAiApproval({
        tenantId: auth.tenantId,
        branchId: auth.branchId,
        userId: auth.userId,
        targetId: product.id,
        approvalId,
        action: "sales_record_edit",
        targetTable: "products"
      });
      if (!approval) {
        return fail("approval_invalid", "PIN นี้หมดอายุ ถูกใช้ไปแล้ว หรือไม่ตรงกับรายการที่กำลังเปลี่ยน", 403);
      }

      const { error: updateError } = await supabase
        .from("products")
        .update({ price: afterPrice })
        .eq("tenant_id", auth.tenantId)
        .eq("branch_id", auth.branchId)
        .eq("id", product.id);
      if (updateError) throw updateError;

      await appendAuditLog({
        tenantId: auth.tenantId,
        branchId: auth.branchId,
        actorUserId: auth.userId,
        actorRole: auth.branchRole ?? auth.platformRole,
        action: "ai_product_price_updated",
        targetTable: "products",
        targetId: product.id,
        module: "cpipos_ai",
        beforeData: { price: beforePrice },
        afterData: { price: afterPrice },
        metadata: {
          source: "cpipos_ai_phase2",
          product_name: product.name,
          category: product.category ?? "",
          reason,
          approval_id: approval.id,
          approved_by: approval.approved_by
        }
      });

      return ok({
        action: body.action,
        status: "completed",
        product_id: product.id,
        product_name: product.name,
        before_price: beforePrice,
        after_price: afterPrice
      });
    }

    const ingredientId = textValue(body.ingredient_id, 80);
    const approvalId = textValue(body.approval_id, 80);
    const quantityDelta = Number(body.quantity_delta);
    const reason = textValue(body.reason, 400) || "CpiPOS AI confirmed stock adjustment";
    if (!ingredientId || !approvalId || !Number.isFinite(quantityDelta) || quantityDelta === 0 || Math.abs(quantityDelta) > 1_000_000) {
      return fail("invalid_stock_action", "Ingredient, quantity, and PIN approval are required.", 422);
    }

    const stockApproval = await consumeAiApproval({
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      userId: auth.userId,
      targetId: ingredientId,
      approvalId,
      action: "stock_adjustment",
      targetTable: "ingredients"
    });
    if (!stockApproval) {
      return fail("approval_invalid", "PIN นี้หมดอายุ ถูกใช้ไปแล้ว หรือไม่ตรงกับรายการปรับสต๊อก", 403);
    }

    const result = await executeStockAdjustmentTransaction({
      auth,
      input: {
        ingredient_id: ingredientId,
        quantity_delta: Number(quantityDelta.toFixed(3)),
        reason: `CpiPOS AI: ${reason}`,
        approval_id: approvalId,
        request_id: request.headers.get("x-idempotency-key")?.trim() || undefined
      },
      appendAuditLog
    });
    if (!result.ok) return fail(result.code, result.message, result.status);

    await appendAuditLog({
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: result.data.duplicate_request ? "ai_stock_adjustment_replayed" : "ai_stock_adjustment_executed",
      targetTable: "stock_movements",
      targetId: result.data.id,
      module: "cpipos_ai",
      metadata: {
        source: "cpipos_ai_phase2",
        ingredient_id: ingredientId,
        quantity_delta: Number(quantityDelta.toFixed(3)),
        reason,
        approval_id: approvalId,
        approved_by: stockApproval.approved_by
      }
    });

    return ok({
      action: body.action,
      status: result.data.duplicate_request ? "replayed" : "completed",
      movement_id: result.data.id,
      created_at: result.data.created_at
    });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    console.error("[cpipos-ai] action execution failed", error);
    return fail("ai_action_failed", "ไม่สามารถดำเนินการตามคำสั่ง CpiPOS AI ได้ในขณะนี้", 500);
  }
}

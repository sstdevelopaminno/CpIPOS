import crypto from "node:crypto";
import { after } from "next/server";
import { fail, ok } from "@/lib/http";
import { appendAuditLog } from "@/lib/audit-log";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { PosGuardError, requireActiveShift, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { buildPaginationMeta, parsePagination } from "@/lib/query-params";
import { dispatchOrderToKitchen } from "@/lib/services/kitchen-routing-service";
import { resolveOrderPricing } from "@/lib/services/pos-sales-mvp-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export async function GET(req: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sales:list:view");
    const { shift } = await requireActiveShift(scope);
    const supabase = getSupabaseServiceClient();
    const { searchParams } = new URL(req.url);
    const { page, pageSize } = parsePagination(searchParams, 12);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const status = searchParams.get("status")?.trim();
    const q = searchParams.get("search")?.trim();

    let query = supabase
      .from("orders")
      .select(
        "id,order_no,order_type,channel,customer_name,external_order_code,total_amount,status,created_at,shift_id,notes,created_by,cash_received,change_amount,payment_completed_at,payment_completed_by",
        { count: "exact" }
      )
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("shift_id", shift.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) {
      query = query.eq("status", status);
    }
    if (q) {
      query = query.or(`order_no.ilike.%${q}%,customer_name.ilike.%${q}%,external_order_code.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      return fail("orders_query_failed", error.message, 500);
    }

    const rows = (data ?? []) as Array<{
      id: string;
      order_no: string;
      order_type: string;
      channel: string;
      customer_name: string | null;
      external_order_code: string | null;
      total_amount: number;
      status: string;
      created_at: string;
      shift_id: string | null;
      notes: string | null;
      created_by: string | null;
      cash_received: number | null;
      change_amount: number | null;
      payment_completed_at: string | null;
      payment_completed_by: string | null;
    }>;

    const userIds = Array.from(
      new Set(rows.flatMap((row) => [row.created_by, row.payment_completed_by]).filter((id): id is string => Boolean(id)))
    );
    const shiftIds = Array.from(new Set(rows.map((row) => row.shift_id).filter((id): id is string => Boolean(id))));

    const [usersResult, shiftsResult, branchResult] = await Promise.all([
      userIds.length > 0
        ? supabase.from("users_profiles").select("id,full_name").in("id", userIds)
        : Promise.resolve({ data: [], error: null } as { data: Array<{ id: string; full_name: string | null }>; error: null }),
      shiftIds.length > 0
        ? supabase.from("shifts").select("id,status,opened_at").in("id", shiftIds)
        : Promise.resolve({ data: [], error: null } as { data: Array<{ id: string; status: string; opened_at: string }>; error: null }),
      supabase.from("branches").select("name").eq("tenant_id", scope.session.tenant_id).eq("id", scope.session.branch_id).maybeSingle<{ name: string | null }>()
    ]);

    if (usersResult.error) {
      return fail("orders_users_query_failed", usersResult.error.message, 500);
    }
    if (shiftsResult.error) {
      return fail("orders_shifts_query_failed", shiftsResult.error.message, 500);
    }
    if (branchResult.error) {
      return fail("orders_branch_query_failed", branchResult.error.message, 500);
    }

    const userMap = new Map((usersResult.data ?? []).map((row) => [row.id, row.full_name ?? row.id]));
    const shiftMap = new Map((shiftsResult.data ?? []).map((row) => [row.id, { status: row.status, opened_at: row.opened_at }]));
    const branchName = branchResult.data?.name ?? scope.session.branch_id;

    const items = rows.map((row) => ({
      ...row,
      seller_name: row.created_by ? userMap.get(row.created_by) ?? row.created_by : "-",
      cashier_name: row.payment_completed_by ? userMap.get(row.payment_completed_by) ?? row.payment_completed_by : "-",
      branch_name: branchName,
      shift_status: row.shift_id ? shiftMap.get(row.shift_id)?.status ?? "-" : "-",
      shift_opened_at: row.shift_id ? shiftMap.get(row.shift_id)?.opened_at ?? null : null
    }));

    return ok({
      items,
      scope: {
        mode: "current_cashier_shift",
        shift_id: shift.id,
        device_code: scope.session.device_code
      },
      pagination: buildPaginationMeta(page, pageSize, count)
    });
  } catch (error) {
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

type CreateOrderPayload = {
  items?: Array<{
    product_id?: string;
    quantity?: number;
  }>;
  discount_total?: number;
  notes?: string | null;
};

export async function POST(request: Request) {
  const supabase = getSupabaseServiceClient();
  let scopeForAudit: { tenantId: string; branchId: string; userId: string; role: string } | null = null;

  const writeOrderFailedAudit = async (reason: string, metadata?: Record<string, unknown>) => {
    if (!scopeForAudit) return;
    void appendAuditLog({
      tenantId: scopeForAudit.tenantId,
      branchId: scopeForAudit.branchId,
      actorUserId: scopeForAudit.userId,
      actorRole: scopeForAudit.role as "owner" | "manager" | "staff" | "accountant",
      action: "order_failed",
      targetTable: "orders",
      metadata: {
        reason,
        ...(metadata ?? {})
      }
    });
  };

  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sale:create");
    const { shift } = await requireActiveShift(scope);
    await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
    scopeForAudit = {
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      userId: scope.session.user_id,
      role: scope.session.role
    };

    const body = (await request.json().catch(() => null)) as CreateOrderPayload | null;
    const pricing = await resolveOrderPricing({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      items: (body?.items ?? []) as Array<{ product_id: string; quantity: number }>,
      discountTotal: body?.discount_total
    });

    if (!pricing.ok) {
      await writeOrderFailedAudit(pricing.code);
      return fail(pricing.code, pricing.message, pricing.status);
    }

    const requestId = request.headers.get("x-idempotency-key")?.trim() || crypto.randomUUID();
    const orderNote = String(body?.notes ?? "").trim() || null;

    const { data: rpcRows, error: rpcError } = await supabase.rpc("create_pos_order_tx", {
      p_tenant_id: scope.session.tenant_id,
      p_branch_id: scope.session.branch_id,
      p_shift_id: shift.id,
      p_created_by: scope.session.user_id,
      p_order_type: "takeaway",
      p_channel: "storefront",
      p_table_id: null,
      p_external_order_code: null,
      p_customer_name: null,
      p_notes: orderNote,
      p_app_total_amount: pricing.totals.subtotal,
      p_discount_amount: pricing.totals.discount_total,
      p_gp_amount: 0,
      p_items: pricing.pricedItems.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity
      })),
      p_request_id: requestId,
      p_order_no: null
    });

    if (rpcError) {
      await writeOrderFailedAudit("rpc_create_pos_order_tx_failed", { message: rpcError.message });
      return fail("order_create_failed", rpcError.message, 500);
    }

    const createdRow = Array.isArray(rpcRows) ? rpcRows[0] : null;
    const orderId = String(createdRow?.order_id ?? "").trim();
    if (!orderId) {
      await writeOrderFailedAudit("order_id_missing_after_rpc");
      return fail("order_create_failed", "Order creation returned no order ID.", 500);
    }

    await supabase
      .from("orders")
      .update({
        device_code: scope.session.device_code,
        cashier_user_id: scope.session.user_id,
        pos_session_id: scope.session.id,
        tax_total: pricing.totals.tax_total,
        grand_total: pricing.totals.grand_total,
        paid_total: 0,
        metadata: {
          source: "pos_sales_mvp",
          request_id: requestId
        }
      })
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("id", orderId);

    const { data: itemRows } = await supabase
      .from("order_items")
      .select("id,product_id")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("order_id", orderId);

    const nameByProduct = new Map(pricing.pricedItems.map((item) => [item.product_id, item.name]));
    for (const row of itemRows ?? []) {
      const productId = String(row.product_id ?? "");
      const name = nameByProduct.get(productId) ?? "Unknown Item";
      await supabase
        .from("order_items")
        .update({
          name,
          metadata: {
            source: "pos_sales_mvp"
          }
        })
        .eq("id", row.id)
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", scope.session.branch_id);
    }

    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,status,subtotal,discount_amount,tax_total,grand_total,paid_total,created_at")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("id", orderId)
      .maybeSingle<{
        id: string;
        order_no: string;
        status: string;
        subtotal: number;
        discount_amount: number;
        tax_total: number | null;
        grand_total: number | null;
        paid_total: number | null;
        created_at: string;
      }>();

    if (orderError || !orderRow) {
      await writeOrderFailedAudit("order_reload_failed", { message: orderError?.message ?? null });
      return fail("order_create_failed", orderError?.message ?? "Cannot load created order.", 500);
    }

    void appendAuditLog({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      actorUserId: scope.session.user_id,
      actorRole: scope.session.role as "owner" | "manager" | "staff" | "accountant",
      action: "order_created",
      targetTable: "orders",
      targetId: orderRow.id,
      metadata: {
        shift_id: shift.id,
        device_code: scope.session.device_code,
        pos_session_id: scope.session.id,
        item_count: pricing.pricedItems.length,
        subtotal: orderRow.subtotal,
        grand_total: orderRow.grand_total ?? pricing.totals.grand_total
      }
    });

    after(async () => {
      const kitchenResult = await dispatchOrderToKitchen({
        tenantId: scope.session.tenant_id,
        branchId: scope.session.branch_id,
        orderId: orderRow.id,
        eventKey: `pos-order:${requestId}`,
        action: "new",
        actorUserId: scope.session.user_id,
        actorRole: scope.session.role
      });
      if (!kitchenResult.ok) {
        console.error("pos_order_kitchen_dispatch_failed", {
          tenant_id: scope.session.tenant_id,
          branch_id: scope.session.branch_id,
          order_id: orderRow.id,
          event_key: kitchenResult.eventKey,
          error: kitchenResult.message
        });
      }
    });

    return ok({
      order: orderRow,
      items: pricing.pricedItems,
      shift: {
        id: shift.id,
        status: shift.status
      }
    }, 201);
  } catch (error) {
    if (error instanceof FeatureGateError) {
      await writeOrderFailedAudit("feature_not_enabled", { message: error.message });
      return fail(error.code, error.message, error.status);
    }
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    await writeOrderFailedAudit("order_create_unhandled_error", { message: error instanceof Error ? error.message : "Unknown error." });
    return fail("order_create_failed", error instanceof Error ? error.message : "Unknown error.", 500);
  }
}

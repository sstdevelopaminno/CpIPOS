import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

function canViewAcrossBranches(role: string | null) {
  return role === "owner" || role === "manager" || role === "accountant";
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:list:view" });
    await requirePosApiFeature(auth, "advanced_sales_reports");
    const orderId = String(new URL(request.url).searchParams.get("order_id") ?? "").trim();
    if (!orderId) return fail("order_id_required", "order_id is required.", 422);

    const supabase = getSupabaseServiceClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,branch_id,status,total_amount,created_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("id", orderId)
      .maybeSingle<{ id: string; order_no: string; branch_id: string; status: string; total_amount: number | null; created_at: string }>();
    if (orderError) return fail("order_query_failed", orderError.message, 500);
    if (!order) return fail("order_not_found", "Sales bill was not found.", 404);

    if (order.branch_id !== auth.branchId) {
      if (!canViewAcrossBranches(auth.branchRole)) return fail("forbidden_branch_scope", "This bill belongs to another branch.", 403);
      const { data: membership, error: membershipError } = await supabase
        .from("user_branch_roles")
        .select("branch_id")
        .eq("tenant_id", auth.tenantId!)
        .eq("user_id", auth.userId)
        .eq("branch_id", order.branch_id)
        .maybeSingle<{ branch_id: string }>();
      if (membershipError) return fail("branch_membership_query_failed", membershipError.message, 500);
      if (!membership) return fail("forbidden_branch_scope", "This bill belongs to another branch.", 403);
    }

    const { data, error } = await supabase
      .from("order_items")
      .select("id,product_id,name,quantity,unit_price,line_total,notes,products(name,sku,category)")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", order.branch_id)
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });
    if (error) return fail("order_items_query_failed", error.message, 500);

    const items = (data ?? []).map((row) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      return {
        id: String(row.id),
        product_id: String(row.product_id),
        name: row.name ?? product?.name ?? String(row.product_id),
        sku: product?.sku ?? null,
        category: product?.category ?? null,
        quantity: Number(row.quantity ?? 0),
        unit_price: Number(row.unit_price ?? 0),
        line_total: Number(row.line_total ?? 0),
        notes: row.notes ?? null
      };
    });

    return ok({
      order: {
        id: order.id,
        bill_no: order.order_no,
        branch_id: order.branch_id,
        status: order.status,
        total: Number(order.total_amount ?? 0),
        created_at: order.created_at
      },
      items
    });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("order_items_fetch_failed", error instanceof Error ? error.message : "Failed to load bill items.", 401);
  }
}

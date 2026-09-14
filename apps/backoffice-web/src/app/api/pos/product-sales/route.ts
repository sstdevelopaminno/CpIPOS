import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type BranchRow = { id: string; code: string | null; name: string | null; is_active: boolean | null };
type OrderRow = { id: string; order_no: string; branch_id: string; status: string; created_at: string };
type ProductJoin = { id?: string | null; sku?: string | null; name?: string | null; category?: string | null };
type ItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  name: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  products?: ProductJoin | ProductJoin[] | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 370;

function bangkokToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dateStartIso(date: string) {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}

function exclusiveEndIso(date: string) {
  const start = new Date(`${date}T00:00:00+07:00`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function canViewAcrossBranches(role: string | null) {
  return role === "owner" || role === "manager" || role === "accountant";
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:list:view" });
    await requirePosApiFeature(auth, "advanced_sales_reports");
    const supabase = getSupabaseServiceClient();
    const { searchParams } = new URL(request.url);

    const today = bangkokToday();
    const fromDate = String(searchParams.get("from") ?? today).trim();
    const toDate = String(searchParams.get("to") ?? fromDate).trim();
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) return fail("invalid_date_range", "Invalid sales date range.", 422);

    const fromMs = new Date(`${fromDate}T00:00:00+07:00`).getTime();
    const toMs = new Date(`${toDate}T00:00:00+07:00`).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return fail("invalid_date_range", "End date must not be before start date.", 422);
    if ((toMs - fromMs) / 86400000 > MAX_RANGE_DAYS) return fail("date_range_too_large", "Sales date range must be 370 days or less.", 422);

    const [branchesResult, membershipResult] = await Promise.all([
      supabase.from("branches").select("id,code,name,is_active").eq("tenant_id", auth.tenantId!).order("name", { ascending: true }),
      supabase
        .from("user_branch_roles")
        .select("branch_id")
        .eq("tenant_id", auth.tenantId!)
        .eq("user_id", auth.userId)
    ]);
    if (branchesResult.error) return fail("product_sales_branch_query_failed", branchesResult.error.message, 500);
    if (membershipResult.error) return fail("product_sales_membership_query_failed", membershipResult.error.message, 500);

    const memberships = new Set((membershipResult.data ?? []).map((row) => String(row.branch_id)));
    const allBranches = ((branchesResult.data ?? []) as BranchRow[])
      .filter((branch) => branch.is_active !== false && memberships.has(String(branch.id)))
      .map((branch) => ({ id: String(branch.id), code: branch.code ?? String(branch.id), name: branch.name ?? branch.code ?? String(branch.id) }));

    const crossBranch = canViewAcrossBranches(auth.branchRole);
    const requestedBranch = String(searchParams.get("branch_id") ?? (crossBranch ? "all" : auth.branchId ?? "")).trim();
    let branchIds: string[];
    if (crossBranch && requestedBranch === "all") {
      branchIds = allBranches.map((branch) => branch.id);
    } else {
      const branchId = requestedBranch || auth.branchId || "";
      if (!branchId || !memberships.has(branchId)) return fail("forbidden_branch_scope", "Branch is outside the current user scope.", 403);
      branchIds = [branchId];
    }

    if (!branchIds.length) {
      return ok({
        from: fromDate,
        to: toDate,
        branch_id: requestedBranch,
        branch_options: allBranches,
        rows: [],
        summary: { line_count: 0, units: 0, revenue: 0 }
      });
    }

    let ordersQuery = supabase
      .from("orders")
      .select("id,order_no,branch_id,status,created_at")
      .eq("tenant_id", auth.tenantId!)
      .in("status", ["completed", "cancelled"])
      .gte("created_at", dateStartIso(fromDate))
      .lt("created_at", exclusiveEndIso(toDate))
      .order("created_at", { ascending: false })
      .limit(2000);
    ordersQuery = branchIds.length === 1 ? ordersQuery.eq("branch_id", branchIds[0]) : ordersQuery.in("branch_id", branchIds);
    const { data: orderData, error: orderError } = await ordersQuery;
    if (orderError) return fail("product_sales_orders_query_failed", orderError.message, 500);

    const orders = (orderData ?? []) as OrderRow[];
    if (!orders.length) {
      return ok({
        from: fromDate,
        to: toDate,
        branch_id: requestedBranch,
        branch_options: allBranches,
        rows: [],
        summary: { line_count: 0, units: 0, revenue: 0 }
      });
    }

    const orderIds = orders.map((order) => order.id);
    const { data: itemData, error: itemError } = await supabase
      .from("order_items")
      .select("id,order_id,product_id,name,quantity,unit_price,line_total,products(id,sku,name,category)")
      .eq("tenant_id", auth.tenantId!)
      .in("order_id", orderIds)
      .gt("quantity", 0)
      .limit(10000);
    if (itemError) return fail("product_sales_items_query_failed", itemError.message, 500);

    const orderById = new Map(orders.map((order) => [order.id, order]));
    const branchById = new Map(allBranches.map((branch) => [branch.id, branch]));
    const completedUnits = new Map<string, number>();
    for (const row of (itemData ?? []) as ItemRow[]) {
      const order = orderById.get(row.order_id);
      if (!order || order.status !== "completed") continue;
      completedUnits.set(row.product_id, (completedUnits.get(row.product_id) ?? 0) + Number(row.quantity ?? 0));
    }
    const rankByProduct = new Map(
      Array.from(completedUnits.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([productId], index) => [productId, index + 1] as const)
    );

    const rows = ((itemData ?? []) as ItemRow[])
      .map((item) => {
        const order = orderById.get(item.order_id);
        if (!order) return null;
        const product = Array.isArray(item.products) ? item.products[0] : item.products;
        const rank = order.status === "completed" ? rankByProduct.get(item.product_id) ?? null : null;
        const bestSellerStatus = order.status === "cancelled"
          ? "cancelled"
          : rank === 1
            ? "top_1"
            : rank === 2
              ? "top_2"
              : rank === 3
                ? "top_3"
                : rank != null && rank <= 10
                  ? "best_seller"
                  : "normal";
        return {
          id: item.id,
          order_id: order.id,
          bill_no: order.order_no,
          sold_at: order.created_at,
          branch_id: order.branch_id,
          branch_name: branchById.get(order.branch_id)?.name ?? order.branch_id,
          product_id: item.product_id,
          sku: product?.sku ?? null,
          product_name: item.name ?? product?.name ?? item.product_id,
          category: product?.category ?? null,
          unit_price: Number(item.unit_price ?? 0),
          quantity: Number(item.quantity ?? 0),
          line_total: Number(item.line_total ?? 0),
          order_status: order.status,
          best_seller_rank: rank,
          best_seller_status: bestSellerStatus
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime());

    const completedRows = rows.filter((row) => row.order_status === "completed");
    return ok({
      from: fromDate,
      to: toDate,
      branch_id: requestedBranch,
      branch_options: allBranches,
      rows,
      summary: {
        line_count: rows.length,
        units: Number(completedRows.reduce((sum, row) => sum + row.quantity, 0).toFixed(3)),
        revenue: Number(completedRows.reduce((sum, row) => sum + row.line_total, 0).toFixed(2))
      }
    });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("product_sales_fetch_failed", error instanceof Error ? error.message : "Failed to load product sales.", 401);
  }
}

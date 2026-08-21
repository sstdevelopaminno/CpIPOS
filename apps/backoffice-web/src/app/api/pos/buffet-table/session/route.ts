import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import {
  loadBuffetTableSessionByCode,
  syncBuffetTableSessionSummary
} from "@/lib/services/buffet-table-session-service";

type SyncPayload = {
  order_id?: string | null;
  table_id?: string | null;
};

async function requireBuffetSessionScope() {
  const scope = await requirePosSession();
  requirePermission(scope, "sales:enter");
  await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
  await requireTenantFeature(scope.session.tenant_id, "table_management", scope.session.branch_id);
  return scope;
}

function mapError(error: unknown) {
  if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
  if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
  const message = error instanceof Error ? error.message : "buffet_table_session_failed";
  if (message === "buffet_table_not_found") return fail("buffet_table_not_found", "Table was not found in the current branch.", 404);
  if (message === "buffet_table_session_not_open") return fail("buffet_table_session_not_open", "Active table bill was not found.", 404);
  return fail("buffet_table_session_failed", message, 500);
}

export async function GET(request: Request) {
  try {
    const scope = await requireBuffetSessionScope();
    const tableCode = new URL(request.url).searchParams.get("table_code")?.trim() ?? "";
    if (!tableCode) return fail("table_code_required", "table_code is required.", 422);

    const data = await loadBuffetTableSessionByCode({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      tableCode
    });
    const response = ok(data);
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireBuffetSessionScope();
    const body = (await request.json().catch(() => null)) as SyncPayload | null;
    const orderId = String(body?.order_id ?? "").trim();
    const tableId = String(body?.table_id ?? "").trim();
    if (!orderId) return fail("order_id_required", "order_id is required.", 422);

    const data = await syncBuffetTableSessionSummary({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      tableId: tableId || null,
      orderId
    });
    invalidatePosScopeRuntimeCaches({ tenantId: scope.session.tenant_id, branchId: scope.session.branch_id });
    return ok(data);
  } catch (error) {
    return mapError(error);
  }
}

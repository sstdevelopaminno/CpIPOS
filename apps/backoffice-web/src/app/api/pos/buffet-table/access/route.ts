import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { buffetPlanFromProduct, buffetPlanModeFromProduct, type BuffetPlanProductRow } from "@/lib/pos-buffet-plan-product";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import {
  loadBuffetTableAccess,
  saveBuffetTableAccess,
  type BuffetTableAccess
} from "@/lib/services/buffet-table-access-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const ACTIVE_TABLE_SESSION_STATUSES = ["open", "ordering", "pending_payment"];

type SavePayload = {
  table_code?: string | null;
  plan_product_id?: string | null;
};

type TableRow = {
  id: string;
  table_code: string;
};

type SessionRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

async function requireBuffetAccessScope() {
  const scope = await requirePosSession();
  requirePermission(scope, "tables:manage");
  await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
  await requireTenantFeature(scope.session.tenant_id, "table_management", scope.session.branch_id);
  return scope;
}

function mapError(error: unknown) {
  if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
  if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
  const message = error instanceof Error ? error.message : "buffet_access_failed";
  if (message === "buffet_access_ambiguous") return fail("buffet_access_ambiguous", "โต๊ะนี้มีแพ็กเกจบุฟเฟ่มากกว่าหนึ่งแบบ กรุณาปิดบิลแล้วเปิดโต๊ะใหม่", 409);
  if (message.includes("not_found")) return fail("buffet_access_not_found", "ไม่พบโต๊ะหรือบิลโต๊ะที่กำลังเปิดอยู่", 404);
  return fail("buffet_access_failed", message, 500);
}

async function loadActiveTableSession(args: { tenantId: string; branchId: string; tableCode: string }) {
  const supabase = getSupabaseServiceClient();
  const { data: table, error: tableError } = await supabase
    .from("dining_tables")
    .select("id,table_code")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("table_code", args.tableCode)
    .eq("is_active", true)
    .maybeSingle<TableRow>();
  if (tableError) throw new Error(`buffet_access_table_query_failed:${tableError.message}`);
  if (!table) throw new Error("buffet_access_table_not_found");

  const { data: session, error: sessionError } = await supabase
    .from("table_bill_sessions")
    .select("id,metadata")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("table_id", table.id)
    .in("status", ACTIVE_TABLE_SESSION_STATUSES)
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<SessionRow>();
  if (sessionError) throw new Error(`buffet_access_session_query_failed:${sessionError.message}`);
  if (!session) throw new Error("buffet_access_session_not_found");
  return { table, session };
}

export async function GET(request: Request) {
  try {
    const scope = await requireBuffetAccessScope();
    const tableCode = new URL(request.url).searchParams.get("table_code")?.trim() ?? "";
    if (!tableCode) return fail("table_code_required", "table_code is required.", 422);
    const resolved = await loadActiveTableSession({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      tableCode
    });
    const state = await loadBuffetTableAccess({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      tableSessionId: resolved.session.id
    });
    return ok({
      table_id: resolved.table.id,
      table_code: resolved.table.table_code,
      table_session_id: resolved.session.id,
      access: state.access,
      source: state.source
    });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireBuffetAccessScope();
    const payload = (await request.json().catch(() => null)) as SavePayload | null;
    const tableCode = String(payload?.table_code ?? "").trim();
    const planProductId = String(payload?.plan_product_id ?? "").trim();
    if (!tableCode) return fail("table_code_required", "table_code is required.", 422);
    if (!planProductId) return fail("buffet_plan_required", "plan_product_id is required.", 422);

    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const supabase = getSupabaseServiceClient();
    const { data: planRow, error: planError } = await supabase
      .from("products")
      .select("id,sku,name,price,is_active,metadata,created_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("id", planProductId)
      .maybeSingle<BuffetPlanProductRow>();
    if (planError) return fail("buffet_plan_query_failed", planError.message, 500);
    const plan = planRow ? buffetPlanFromProduct(planRow, 0) : null;
    if (!planRow || !buffetPlanModeFromProduct(planRow) || !plan || !plan.is_active || plan.price <= 0 || plan.draft) {
      return fail("buffet_plan_not_available", "แพ็กเกจบุฟเฟ่นี้ไม่ได้เปิดใช้งาน", 409);
    }

    const resolved = await loadActiveTableSession({ tenantId, branchId, tableCode });
    const current = await loadBuffetTableAccess({
      tenantId,
      branchId,
      tableSessionId: resolved.session.id
    });
    const exactPlanId = String(plan.product_id ?? plan.id);
    if (current.access && current.access.plan_product_id !== exactPlanId) {
      return fail(
        "buffet_package_locked",
        `โต๊ะนี้ถูกเปิดด้วยแพ็กเกจ ${current.access.plan_name} แล้ว ไม่สามารถเปลี่ยนแพ็กเกจกลางบิลได้`,
        409
      );
    }

    const now = new Date().toISOString();
    const access: BuffetTableAccess = current.access ?? {
      mode: plan.mode,
      plan_product_id: exactPlanId,
      plan_code: plan.code,
      plan_name: plan.name,
      selected_at: now,
      updated_at: now
    };
    const nextAccess: BuffetTableAccess = {
      ...access,
      plan_code: plan.code,
      plan_name: plan.name,
      updated_at: now
    };
    await saveBuffetTableAccess({
      tenantId,
      branchId,
      tableSessionId: resolved.session.id,
      currentMetadata: current.session.metadata,
      access: nextAccess
    });
    invalidatePosScopeRuntimeCaches({ tenantId, branchId });
    return ok({
      table_id: resolved.table.id,
      table_code: resolved.table.table_code,
      table_session_id: resolved.session.id,
      access: nextAccess
    });
  } catch (error) {
    return mapError(error);
  }
}

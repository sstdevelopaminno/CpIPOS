import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { PosGuardError, type PosSessionScope } from "@/lib/pos-session-guard";

export type RecyclingStockBranch = {
  id: string;
  name: string;
  canManage: boolean;
};

/**
 * Authoritative per-tenant branch scope for CUSTOM Recycling stock.
 * Owner can view/manage all ACTIVE branches of their tenant.
 * Manager can view assigned branches; changing catalog requires a manager
 * (or owner) role at the TARGET branch. Staff stay on the session branch.
 * This never changes the POS session's cashier or shift branch.
 */
export async function getRecyclingStockBranches(scope: PosSessionScope): Promise<RecyclingStockBranch[]> {
  const { tenant_id: tenantId, branch_id: sessionBranch, user_id: userId } = scope.session;
  const role = String(scope.session.role ?? "").toLowerCase();
  const db = getSupabaseServiceClient();
  const [all, memberships] = await Promise.all([
    db.from("branches").select("id,name")
      .eq("tenant_id", tenantId).eq("is_active", true).order("name", {ascending: true}),
    role === "owner"
      ? Promise.resolve({ data: [] as Array<{branch_id:string;role:string}>, error: null })
      : db.from("user_branch_roles").select("branch_id,role")
        .eq("tenant_id", tenantId).eq("user_id", userId)
  ]);
  if (all.error || memberships.error) {
    throw new PosGuardError("recycling_stock_branches_unavailable",
      "ไม่สามารถตรวจสอบสิทธิ์สาขาได้ กรุณาลองอีกครั้ง", 503);
  }
  const roles = new Map((memberships.data ?? []).map(row => [
    String(row.branch_id), String(row.role ?? "").toLowerCase()
  ]));
  const visible = (all.data ?? []).filter(row => role === "owner"
    || (row.id === sessionBranch && role !== "manager")
    || roles.has(row.id)
  ).map(row => ({
    id: String(row.id),
    name: String(row.name ?? row.id),
    canManage: role === "owner" || (role === "manager" &&
      ["manager","owner"].includes(roles.get(row.id) ?? ""))
  }));
  // Fail closed if a role or membership change took away the session branch.
  if (!visible.some(row => row.id === sessionBranch)) {
    throw new PosGuardError("recycling_stock_session_branch_forbidden",
      "ไม่มีสิทธิ์เข้าถึงสาขาที่เข้าสู่ระบบ", 403);
  }
  return visible;
}

export function requireRecyclingStockBranch(
  requested: string,
  available: RecyclingStockBranch[],
  requireManage: boolean
): RecyclingStockBranch {
  const branch = available.find(row => row.id === requested);
  if (!branch || (requireManage && !branch.canManage)) {
    throw new PosGuardError("recycling_stock_branch_forbidden",
      "ไม่มีสิทธิ์จัดการวัสดุของสาขาที่เลือก", 403);
  }
  return branch;
}

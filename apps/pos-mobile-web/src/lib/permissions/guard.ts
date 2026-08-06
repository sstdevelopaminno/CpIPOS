import { redirect } from "next/navigation";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { roleCan } from "@/lib/permissions/mobile-features";
import { createServiceClient } from "@/lib/supabase/server";
import type { BranchRole, MobilePermissionKey } from "@/types/contracts";

export async function requireMobileSession(roles?: BranchRole[]) {
  const session = await requireActiveMobileSession();
  if (!session) redirect("/login/store");
  if (roles && !roles.includes(session.role)) redirect("/orders?error=unauthorized");
  return session;
}

export async function requireMobilePermission(permission: MobilePermissionKey) {
  const session = await requireMobileSession();
  if (!roleCan(session.role, permission)) redirect("/orders?error=unauthorized");
  return session;
}

export async function requireOpenShift(rolesOrPermission?: BranchRole[] | MobilePermissionKey) {
  const scope = Array.isArray(rolesOrPermission) ? await requireMobileSession(rolesOrPermission) : rolesOrPermission ? await requireMobilePermission(rolesOrPermission) : await requireMobileSession();
  const supabase = createServiceClient();
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id,status,opened_at,device_code")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("device_code", scope.deviceCode)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!shift) {
    const canOpenShift = scope.role === "owner" || scope.role === "manager" || scope.role === "staff";
    redirect(canOpenShift ? "/shifts" : "/login/store");
  }
  return { scope, shift };
}

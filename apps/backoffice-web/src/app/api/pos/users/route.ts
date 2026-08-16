import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { appendAuditLog } from "@/lib/audit-log";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { validateManagerPin } from "@/lib/pin-approval";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { PosGuardError, type PosPermission } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type BranchRole = "owner" | "manager" | "staff" | "accountant" | "kitchen";
type ScopeMode = "all_devices" | "single_device";

type UserScopeRow = {
  user_id: string;
  branch_id: string;
  scope_mode: ScopeMode;
  device_id: string | null;
};

type UserProfileSettingsRow = {
  user_id: string;
  employee_code: string | null;
  position_title: string | null;
  permission_role: string | null;
};

type UserApprovalPermissionRow = {
  user_id: string;
  branch_id: string;
  action: "cancel_bill";
  is_enabled: boolean;
};

type BranchRow = {
  id: string;
  code: string | null;
  name: string | null;
  is_active: boolean | null;
};

type PatchPayload =
  | {
      action: "update_profile";
      user_id?: string;
      branch_id?: string;
      full_name?: string;
      email?: string;
      role?: BranchRole;
      position_title?: string;
      permission_role?: string;
      employee_code?: string;
      approval_pin?: string;
    }
  | { action: "set_pin"; user_id?: string; branch_id?: string; pin?: string; approval_pin?: string }
  | {
      action: "set_cancel_bill_approval";
      user_id?: string;
      branch_id?: string;
      is_enabled?: boolean;
      pin?: string;
      approval_pin?: string;
    }
  | { action: "set_active"; user_id?: string; branch_id?: string; is_active?: boolean }
  | { action: "set_device_scope"; user_id?: string; branch_id?: string; scope_mode?: ScopeMode; device_id?: string | null };

type CreatePayload = {
  full_name?: string;
  email?: string;
  role?: BranchRole;
  branch_id?: string;
  pin?: string;
  is_active?: boolean;
  scope_mode?: ScopeMode;
  device_id?: string | null;
  employee_code?: string;
  position_title?: string;
  permission_role?: string;
  approval_pin?: string;
  can_approve_cancel_bill?: boolean;
};

function isMissingRelationError(error: { code?: string | null; message?: string | null } | null | undefined, relationName: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  const relation = relationName.toLowerCase();
  return (
    code === "42P01" ||
    (code === "PGRST205" && message.includes(relation)) ||
    (message.includes("does not exist") &&
      (message.includes(`"${relation}"`) || message.includes(`.${relation}"`) || message.includes(`'${relation}'`) || message.includes(relation)))
  );
}

function isMissingRpcError(error: { code?: string | null; message?: string | null } | null | undefined, functionName: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  const functionKey = functionName.toLowerCase();
  return code === "PGRST202" || (message.includes(functionKey) && (message.includes("schema cache") || message.includes("could not find")));
}

function normalizeRole(value: string): BranchRole {
  if (value === "owner" || value === "manager" || value === "accountant" || value === "kitchen") return value;
  return "staff";
}

function deriveEmployeeCode(userId: string) {
  const normalized = String(userId).replace(/-/g, "").toUpperCase();
  return `EMP-${normalized.slice(-6)}`;
}

function deriveDemoEmployeeCode(input: { userId: string; email: string; role: BranchRole }) {
  const email = String(input.email ?? "").toLowerCase();
  const isDemoUser = email.endsWith(".local") || email.endsWith("@demo.local");
  if (!isDemoUser) return null;
  if (input.role === "owner" && (email.startsWith("owner@") || email.startsWith("owner."))) return "182536";
  const suffix = String(input.userId).replace(/-/g, "").slice(-6).toUpperCase();
  if (input.role === "manager") return `MGR-${suffix}`;
  if (input.role === "accountant") return `ACC-${suffix}`;
  if (input.role === "kitchen") return `KIT-${suffix}`;
  return `STF-${suffix}`;
}

function normalizeEmployeeCode(value: string) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 32);
}

function isValidEmployeeCode(value: string) {
  return /^\d{1,32}$/.test(value);
}

function isDuplicateEmployeeCodeError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return error.code === "23505" && (message.includes("employee_code") || message.includes("pos_user_profiles"));
}

function supabaseWriteError(error: { code?: string | null; message?: string | null }) {
  const nextError = new Error(String(error.message ?? "Database write failed.")) as Error & { code?: string | null };
  nextError.code = error.code ?? null;
  return nextError;
}

function normalizePermissionRole(value: string | null | undefined, fallback: BranchRole) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function canActorAdd(actorRole: BranchRole | null | undefined) {
  return actorRole === "owner" || actorRole === "manager";
}

function canActorDelete(actorRole: BranchRole | null | undefined) {
  return actorRole === "owner";
}

function canActorEditTarget(input: { actorRole: BranchRole | null | undefined; actorUserId: string; targetUserId: string; targetRole: BranchRole }) {
  if (input.actorRole === "owner") return true;
  if (input.actorRole !== "manager") return false;
  if (input.targetRole === "owner") return false;
  if (input.actorUserId === input.targetUserId) return false;
  return input.targetRole === "staff" || input.targetRole === "accountant" || input.targetRole === "kitchen";
}

async function getPosUsersAuthContext(requiredPermission: PosPermission): Promise<AuthContext> {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission });
    await requirePosApiFeature(auth, "user_management");
    return auth;
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) throw error;
    if (!(error instanceof PosGuardError) || error.status !== 401) {
      throw error;
    }
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "user_management");
    return auth;
  }
}

function resolveSessionBranchId(auth: AuthContext, requestedBranchId?: string | null) {
  const sessionBranchId = String(auth.branchId ?? "").trim();
  if (!sessionBranchId) {
    throw new Error("branch_scope_required");
  }
  const requested = String(requestedBranchId ?? "").trim();
  if (requested && requested !== sessionBranchId) {
    throw new Error("forbidden_branch_scope");
  }
  return sessionBranchId;
}

function normalizeManagerRoleChange(actorRole: BranchRole | null | undefined, requestedRole: BranchRole, currentRole: BranchRole) {
  if (actorRole === "owner") return requestedRole;
  if (actorRole === "manager") {
    if (requestedRole === "staff" || requestedRole === "accountant" || requestedRole === "kitchen") return requestedRole;
    return currentRole;
  }
  return currentRole;
}

async function requireApprovalPin(input: { pin?: string; tenantId: string; branchId: string }) {
  const pin = String(input.pin ?? "").trim();
  if (!pin) return { approved: false };
  const approval = await validateManagerPin("employee_delete", pin, {
    tenantId: input.tenantId,
    branchId: input.branchId
  });
  return approval;
}

async function requireOwnerApprovalPin(input: { pin?: string; tenantId: string; branchId: string }) {
  const approval = await requireApprovalPin(input);
  return approval.approved && approval.approverRole === "owner" ? approval : { approved: false as const };
}

async function getTargetRole(input: { tenantId: string; branchId: string; userId: string }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_branch_roles")
    .select("role")
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId)
    .eq("user_id", input.userId)
    .maybeSingle<{ role: BranchRole }>();
  if (error) throw new Error(error.message);
  return data ? normalizeRole(data.role) : null;
}

async function loadProfileSettings(tenantId: string, userIds: string[]) {
  const supabase = getSupabaseServiceClient();
  const settingsByUser = new Map<string, UserProfileSettingsRow>();
  if (!userIds.length) return settingsByUser;

  const { data, error } = await supabase
    .from("pos_user_profiles")
    .select("user_id,employee_code,position_title,permission_role")
    .eq("tenant_id", tenantId)
    .in("user_id", userIds);

  if (error) {
    if (isMissingRelationError(error, "pos_user_profiles")) return settingsByUser;
    throw supabaseWriteError(error);
  }

  for (const row of (data ?? []) as UserProfileSettingsRow[]) {
    settingsByUser.set(row.user_id, row);
  }
  return settingsByUser;
}

async function upsertProfileSettings(input: {
  tenantId: string;
  userId: string;
  employeeCode: string;
  positionTitle: string;
  permissionRole: string;
}) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pos_user_profiles")
    .upsert(
      {
        tenant_id: input.tenantId,
        user_id: input.userId,
        employee_code: input.employeeCode,
        position_title: input.positionTitle,
        permission_role: input.permissionRole
      },
      { onConflict: "tenant_id,user_id" }
    )
    .select("user_id,employee_code,position_title,permission_role")
    .single<UserProfileSettingsRow>();
  if (error) {
    if (isMissingRelationError(error, "pos_user_profiles")) {
      throw new Error("POS user profile table is missing. Please run Supabase migrations.");
    }
    throw new Error(error.message);
  }
  if (!data || data.user_id !== input.userId || normalizeEmployeeCode(data.employee_code ?? "") !== input.employeeCode) {
    throw new Error("POS user profile update was not persisted.");
  }
}

async function findEmployeeCodeOwner(input: { tenantId: string; employeeCode: string }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pos_user_profiles")
    .select("user_id")
    .eq("tenant_id", input.tenantId)
    .eq("employee_code", input.employeeCode)
    .maybeSingle<{ user_id: string }>();

  if (error) {
    if (isMissingRelationError(error, "pos_user_profiles")) {
      throw new Error("POS user profile table is missing. Please run Supabase migrations.");
    }
    throw new Error(error.message);
  }

  return data?.user_id ?? null;
}

export async function GET(request: Request) {
  try {
    const auth = await getPosUsersAuthContext("users:view");
    if (auth.branchRole !== "owner" && auth.branchRole !== "manager") {
      return fail("forbidden_role", "Only owner or manager can view POS users.", 403);
    }

    const supabase = getSupabaseServiceClient();
    const { searchParams } = new URL(request.url);
    const branchFilter = resolveSessionBranchId(auth, searchParams.get("branch_id"));

    const branchesQuery = supabase.from("branches").select("id,code,name,is_active").eq("tenant_id", auth.tenantId!).order("name", { ascending: true });
    let userQuery = supabase.from("user_branch_roles").select("id,user_id,branch_id,role,is_default,users_profiles!inner(id,full_name,email,is_active)").eq("tenant_id", auth.tenantId!).order("branch_id", { ascending: true }).order("role", { ascending: true });
    let deviceQuery = supabase.from("branch_devices").select("id,branch_id,device_code,device_name,status").eq("tenant_id", auth.tenantId!).order("device_code", { ascending: true });
    let scopeQuery = supabase.from("pos_user_device_scopes").select("user_id,branch_id,scope_mode,device_id").eq("tenant_id", auth.tenantId!);
    let approvalPermissionQuery = supabase.from("pos_user_approval_permissions").select("user_id,branch_id,action,is_enabled").eq("tenant_id", auth.tenantId!).eq("action", "cancel_bill");

    userQuery = userQuery.eq("branch_id", branchFilter);
    deviceQuery = deviceQuery.eq("branch_id", branchFilter);
    scopeQuery = scopeQuery.eq("branch_id", branchFilter);
    approvalPermissionQuery = approvalPermissionQuery.eq("branch_id", branchFilter);

    const [branchesResult, usersResult, devicesResult, scopesResult, approvalPermissionsResult] = await Promise.all([branchesQuery, userQuery, deviceQuery, scopeQuery, approvalPermissionQuery]);
    if (branchesResult.error) return fail("branches_query_failed", branchesResult.error.message, 500);
    if (usersResult.error) return fail("pos_users_query_failed", usersResult.error.message, 500);
    if (devicesResult.error) return fail("pos_devices_query_failed", devicesResult.error.message, 500);
    if (scopesResult.error && !isMissingRelationError(scopesResult.error, "pos_user_device_scopes")) return fail("pos_user_scope_query_failed", scopesResult.error.message, 500);
    if (approvalPermissionsResult.error && !isMissingRelationError(approvalPermissionsResult.error, "pos_user_approval_permissions")) return fail("pos_user_approval_permission_query_failed", approvalPermissionsResult.error.message, 500);

    const branches = ((branchesResult.data ?? []) as BranchRow[]).filter((branch) => branch.is_active !== false);
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const scopeByKey = new Map<string, UserScopeRow>();
    for (const row of ((scopesResult.error ? [] : scopesResult.data) ?? []) as UserScopeRow[]) scopeByKey.set(`${row.branch_id}:${row.user_id}`, row);
    const cancelBillApprovalByKey = new Map<string, boolean>();
    for (const row of ((approvalPermissionsResult.error ? [] : approvalPermissionsResult.data) ?? []) as UserApprovalPermissionRow[]) cancelBillApprovalByKey.set(`${row.branch_id}:${row.user_id}`, row.is_enabled);

    const rawRows = (usersResult.data ?? []) as Array<{
      id: string;
      user_id: string;
      branch_id: string;
      role: BranchRole;
      is_default: boolean;
      users_profiles: { id: string; full_name: string | null; email: string | null; is_active: boolean } | Array<{ id: string; full_name: string | null; email: string | null; is_active: boolean }>;
    }>;
    const rows = auth.branchRole === "manager" ? rawRows.filter((row) => row.role !== "owner") : rawRows;
    const userIds = Array.from(new Set(rows.map((row) => row.user_id));
    const settingsByUser = await loadProfileSettings(auth.tenantId!, userIds);

    const items = rows.map((row) => {
      const profile = Array.isArray(row.users_profiles) ? row.users_profiles[0] : row.users_profiles;
      const scope = scopeByKey.get(`${row.branch_id}:${row.user_id}`);
      const settings = settingsByUser.get(row.user_id);
      const branch = branchById.get(row.branch_id);
      const role = normalizeRole(row.role);
      const demoEmployeeCode = deriveDemoEmployeeCode({ userId: row.user_id, email: profile?.email ?? "", role });
      const employeeCode = normalizeEmployeeCode(settings?.employee_code ?? "") || demoEmployeeCode || deriveEmployeeCode(row.user_id);
      return {
        user_id: row.user_id,
        branch_id: row.branch_id,
        branch_name: branch?.name ?? row.branch_id,
        branch_code: branch?.code ?? "",
        role,
        permission_role: normalizePermissionRole(settings?.permission_role, role),
        position_title: settings?.position_title ?? "",
        employee_code: employeeCode,
        is_default: row.is_default,
        full_name: profile?.full_name ?? "",
        email: profile?.email ?? "",
        is_active: profile?.is_active ?? false,
        can_edit: canActorEditTarget({ actorRole: auth.branchRole, actorUserId: auth.userId, targetUserId: row.user_id, targetRole: role }),
        can_delete: canActorDelete(auth.branchRole) && auth.userId !== row.user_id,
        can_approve_cancel_bill: role === "staff" && cancelBillApprovalByKey.get(`${row.branch_id}:${row.user_id}`) === true,
        device_scope: { scope_mode: scope?.scope_mode ?? "all_devices", device_id: scope?.device_id ?? null }
      };
    });

    return ok({
      items,
      branches: branches.map((branch) => ({ id: branch.id, code: branch.code ?? "", name: branch.name ?? branch.code ?? branch.id })),
      devices: (devicesResult.data ?? []).map((device) => ({ id: String((device as { id?: string }).id ?? ""), branch_id: String((device as { branch_id?: string }).branch_id ?? ""), device_code: String((device as { device_code?: string }).device_code ?? ""), device_name: String((device as { device_name?: string }).device_name ?? ""), status: String((device as { status?: string }).status ?? "active") })),
      metadata: { role: auth.branchRole, user_id: auth.userId, tenant_id: auth.tenantId, branch_id: auth.branchId, can_add: canActorAdd(auth.branchRole), can_delete: canActorDelete(auth.branchRole) }
    });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    if (error instanceof Error && error.message === "forbidden_branch_scope") return fail("forbidden_branch_scope", "Cross-branch access is not allowed.", 403);
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getPosUsersAuthContext("users:manage");
    const body = (await request.json()) as PatchPayload;
    const action = String(body?.action ?? "").trim();
    const userId = String((body as { user_id?: string })?.user_id ?? "").trim();
    const branchId = resolveSessionBranchId(auth, (body as { branch_id?: string })?.branch_id);
    if (!userId || !branchId) return fail("invalid_payload", "user_id and branch_id are required.", 422);

    const targetRole = await getTargetRole({ tenantId: auth.tenantId!, branchId, userId });
    if (!targetRole) return fail("user_not_found", "User was not found in this branch.", 404);
    if (!canActorEditTarget({ actorRole: auth.branchRole, actorUserId: auth.userId, targetUserId: userId, targetRole })) return fail("forbidden_target_role", "This user cannot be edited by the current role.", 403);

    const supabase = getSupabaseServiceClient();
    if (action === "update_profile") {
      const payload = body as Extract<PatchPayload, { action: "update_profile" }>;
      const fullName = String(payload.full_name ?? "").trim();
      const email = String(payload.email ?? "").trim().toLowerCase();
      const requestedRole = normalizeRole(String(payload.role ?? targetRole));
      const nextRole = normalizeManagerRoleChange(auth.branchRole, requestedRole, targetRole);
      const currentSettings = await loadProfileSettings(auth.tenantId!, [userId]);
      const { data: profileForCode, error: profileForCodeError } = await supabase.from("users_profiles").select("email").eq("id", userId).maybeSingle<{ email: string | null }>();
      if (profileForCodeError) return fail("user_profile_lookup_failed", profileForCodeError.message, 500);
      const demoEmployeeCode = deriveDemoEmployeeCode({ userId, email: profileForCode?.email ?? "", role: targetRole });
      const currentEmployeeCode = normalizeEmployeeCode(currentSettings.get(userId)?.employee_code ?? "") || demoEmployeeCode || deriveEmployeeCode(userId);
      const rawEmployeeCode = String(payload.employee_code ?? "").trim();
      const employeeCode = normalizeEmployeeCode(rawEmployeeCode) || currentEmployeeCode;
      const employeeCodeChanged = employeeCode !== currentEmployeeCode;
      const positionTitle = String(payload.position_title ?? "").trim();
      const permissionRole = normalizePermissionRole(payload.permission_role, nextRole);
      if (!fullName || !email || !email.includes("@")) return fail("invalid_profile", "Full name and valid email are required.", 422);
      if (rawEmployeeCode && !isValidEmployeeCode(rawEmployeeCode)) return fail("invalid_employee_code", "Employee code must contain numbers only.", 422);

      if (employeeCodeChanged) {
        try {
          const employeeCodeOwner = await findEmployeeCodeOwner({ tenantId: auth.tenantId!, employeeCode });
          if (employeeCodeOwner && employeeCodeOwner !== userId) return fail("employee_code_duplicate", "This employee code is already assigned to another POS user.", 409);
        } catch (error) {
          return fail("employee_code_check_failed", error instanceof Error ? error.message : "Unable to verify employee code.", 500);
        }
      }

      const ownerActorEditingOwner = auth.branchRole === "owner" && targetRole === "owner";
      const pinApproval = employeeCodeChanged && !ownerActorEditingOwner ? await requireApprovalPin({ pin: payload.approval_pin, tenantId: auth.tenantId!, branchId }) : { approved: true };
      if (employeeCodeChanged && !ownerActorEditingOwner && !pinApproval.approved) return fail("approval_pin_required", "PIN approval is required to update employee code.", 403);

      const { data: updatedProfile, error: profileError } = await supabase.from("users_profiles").update({ full_name: fullName, email }).eq("id", userId).select("id,full_name,email").maybeSingle<{ id: string; full_name: string | null; email: string | null }>();
      if (profileError) return fail("user_profile_update_failed", profileError.message, 500);
      if (!updatedProfile) return fail("user_profile_not_found", "User profile was not found.", 404);

      if (nextRole !== targetRole) {
        const { data: updatedRole, error: roleError } = await supabase.from("user_branch_roles").update({ role: nextRole }).eq("tenant_id", auth.tenantId!).eq("branch_id", branchId).eq("user_id", userId).select("user_id,role").maybeSingle<{ user_id: string; role: BranchRole }>();
        if (roleError) return fail("user_role_update_failed", roleError.message, 500);
        if (!updatedRole) return fail("user_role_not_found", "User branch role was not found.", 404);
      }

      try {
        await upsertProfileSettings({ tenantId: auth.tenantId!, userId, employeeCode, positionTitle, permissionRole });
      } catch (error) {
        if (isDuplicateEmployeeCodeError(error as { code?: string | null; message?: string | null })) return fail("employee_code_duplicate", "This employee code is already assigned to another POS user.", 409);
        return fail("pos_user_profile_update_failed", error instanceof Error ? error.message : "Unable to update POS user profile.", 500);
      }

      void appendAuditLog({ tenantId: auth.tenantId!, branchId, actorUserId: auth.userId, actorRole: auth.branchRole ?? "manager", targetUserId: userId, action: "pos_user_profile_updated", targetTable: "users_profiles", targetId: userId, metadata: { role: nextRole, target_role: targetRole, employee_code: employeeCode, position_title: positionTitle } });
      return ok({ user_id: userId, branch_id: branchId, action: "update_profile", role: nextRole });
    }

    if (action === "set_pin") {
      const payload = body as Extract<PatchPayload, { action: "set_pin" }>;
      const pin = String(payload.pin ?? "").trim();
      if (!/^\d{4,12}$/.test(pin)) return fail("invalid_pin", "PIN must be 4-12 digits.", 422);
      if (targetRole === "staff") return fail("staff_pin_requires_owner_grant", "Staff PIN must be configured by the owner together with cancel-bill approval.", 403);
      const ownerActorSettingOwnerPin = auth.branchRole === "owner" && targetRole === "owner";
      const approval = ownerActorSettingOwnerPin ? { approved: true } : await requireApprovalPin({ pin: payload.approval_pin, tenantId: auth.tenantId!, branchId });
      if (!approval.approved) return fail("approval_pin_required", "PIN approval is required to update user PIN.", 403);
      const pinHash = await bcrypt.hash(pin, 10);
      const { data: updatedProfile, error } = await supabase.from("users_profiles").update({ pin_hash: pinHash }).eq("id", userId).select("id").maybeSingle<{ id: string }>();
      if (error) return fail("user_pin_update_failed", error.message, 500);
      if (!updatedProfile) return fail("user_profile_not_found", "User profile was not found.", 404);
      return ok({ user_id: userId, branch_id: branchId, action: "set_pin" });
    }

    if (action === "set_cancel_bill_approval") {
      if (auth.branchRole !== "owner") return fail("owner_approval_required", "Only the owner can grant staff cancel-bill PIN authority.", 403);
      if (targetRole !== "staff") return fail("staff_role_required", "Cancel-bill PIN authority can only be assigned to staff.", 422);
      const payload = body as Extract<PatchPayload, { action: "set_cancel_bill_approval" }>;
      const isEnabled = Boolean(payload.is_enabled);
      const pin = String(payload.pin ?? "").trim();
      if (isEnabled && !/^\d{4,12}$/.test(pin)) return fail("staff_pin_required", "A 4-12 digit staff PIN is required when enabling cancel-bill approval.", 422);
      const ownerApproval = await requireOwnerApprovalPin({ pin: payload.approval_pin, tenantId: auth.tenantId!, branchId });
      if (!ownerApproval.approved) return fail("owner_pin_required", "Owner PIN approval is required to change staff cancel-bill authority.", 403);
      const pinHash = isEnabled ? await bcrypt.hash(pin, 10) : null;
      const { error: permissionError } = await supabase.rpc("configure_staff_cancel_bill_approval", { p_tenant_id: auth.tenantId!, p_branch_id: branchId, p_user_id: userId, p_is_enabled: isEnabled, p_pin_hash: pinHash, p_granted_by: auth.userId });
      if (permissionError) {
        if (isMissingRpcError(permissionError, "configure_staff_cancel_bill_approval")) return fail("staff_approval_table_missing", "Staff approval permission table is missing. Please run Supabase migrations.", 500);
        return fail("staff_approval_update_failed", permissionError.message, 500);
      }
      void appendAuditLog({ tenantId: auth.tenantId!, branchId, actorUserId: auth.userId, actorRole: "owner", targetUserId: userId, action: isEnabled ? "staff_cancel_bill_approval_granted" : "staff_cancel_bill_approval_revoked", targetTable: "pos_user_approval_permissions", targetId: userId, metadata: { approval_action: "cancel_bill", is_enabled: isEnabled, approved_by: ownerApproval.approverUserId } });
      return ok({ user_id: userId, branch_id: branchId, action, is_enabled: isEnabled });
    }

    if (action === "set_active") {
      const payload = body as Extract<PatchPayload, { action: "set_active" }>;
      const isActive = Boolean(payload.is_active);
      const { data: updatedProfile, error } = await supabase.from("users_profiles").update({ is_active: isActive }).eq("id", userId).select("id,is_active").maybeSingle<{ id: string; is_active: boolean }>();
      if (error) return fail("user_status_update_failed", error.message, 500);
      if (!updatedProfile) return fail("user_profile_not_found", "User profile was not found.", 404);
      return ok({ user_id: userId, branch_id: branchId, action: "set_active", is_active: isActive });
    }

    if (action === "set_device_scope") {
      const payload = body as Extract<PatchPayload, { action: "set_device_scope" }>;
      const scopeMode = payload.scope_mode === "single_device" ? "single_device" : "all_devices";
      const deviceId = String(payload.device_id ?? "").trim() || null;
      if (scopeMode === "single_device" && !deviceId) return fail("invalid_scope_device", "device_id is required for single_device mode.", 422);
      const upsertScope = await supabase.from("pos_user_device_scopes").upsert({ tenant_id: auth.tenantId!, branch_id: branchId, user_id: userId, scope_mode: scopeMode, device_id: scopeMode === "single_device" ? deviceId : null }, { onConflict: "tenant_id,branch_id,user_id" }).select("user_id,scope_mode,device_id").single();
      if (upsertScope.error) {
        if (isMissingRelationError(upsertScope.error, "pos_user_device_scopes")) return fail("pos_user_scope_table_missing", "Device scope table is missing. Please run migrations.", 500);
        return fail("pos_user_scope_update_failed", upsertScope.error.message, 500);
      }
      return ok({ user_id: userId, branch_id: branchId, action: "set_device_scope", scope_mode: scopeMode, device_id: deviceId });
    }

    return fail("invalid_action", "Unsupported action.", 422);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    if (error instanceof Error && error.message === "forbidden_branch_scope") return fail("forbidden_branch_scope", "Cross-branch access is not allowed.", 403);
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getPosUsersAuthContext("users:manage");
    if (!canActorAdd(auth.branchRole)) return fail("forbidden_role", "Only owner or manager can add POS users.", 403);
    const body = (await request.json()) as CreatePayload;
    const fullName = String(body.full_name ?? "").trim();
    const requestedEmail = String(body.email ?? "").trim().toLowerCase();
    const branchId = resolveSessionBranchId(auth, body.branch_id);
    const requestedRole = normalizeRole(String(body.role ?? "staff"));
    const role = auth.branchRole === "manager" && (requestedRole === "owner" || requestedRole === "manager") ? "staff" : requestedRole;
    const pin = String(body.pin ?? "").trim();
    const scopeMode = body.scope_mode === "single_device" ? "single_device" : "all_devices";
    const deviceId = String(body.device_id ?? "").trim() || null;
    const rawEmployeeCodeInput = String(body.employee_code ?? "").trim();
    if (!rawEmployeeCodeInput) return fail("employee_code_required", "Employee code is required.", 422);
    if (!isValidEmployeeCode(rawEmployeeCodeInput)) return fail("invalid_employee_code", "Employee code must contain numbers only.", 422);
    const employeeCodeInput = normalizeEmployeeCode(rawEmployeeCodeInput);
    const positionTitle = String(body.position_title ?? "").trim();
    const permissionRole = normalizePermissionRole(body.permission_role, role);
    const canApproveCancelBill = role === "staff" && Boolean(body.can_approve_cancel_bill);

    if (!fullName || !branchId) return fail("invalid_profile", "Full name and branch are required.", 422);
    if (requestedEmail && !requestedEmail.includes("@")) return fail("invalid_email", "A valid email is required.", 422);
    if (pin && !/^\d{4,12}$/.test(pin)) return fail("invalid_pin", "PIN must be 4-12 digits.", 422);
    if (scopeMode === "single_device" && !deviceId) return fail("invalid_scope_device", "device_id is required for single_device mode.", 422);
    if (role === "staff" && pin && !canApproveCancelBill) return fail("staff_pin_requires_owner_grant", "Staff PIN requires owner-granted cancel-bill authority.", 403);
    if (canApproveCancelBill && !/^\d{4,12}$/.test(pin)) return fail("staff_pin_required", "A 4-12 digit staff PIN is required when enabling cancel-bill approval.", 422);
    if (canApproveCancelBill && auth.branchRole !== "owner") return fail("owner_approval_required", "Only the owner can grant staff cancel-bill PIN authority.", 403);

    const ownerActorCreatingOwner = auth.branchRole === "owner" && role === "owner";
    const needsOwnerApproval = canApproveCancelBill;
    const needsApproval = Boolean(employeeCodeInput || pin) && !ownerActorCreatingOwner;
    const approval = ownerActorCreatingOwner ? { approved: true } : needsOwnerApproval ? await requireOwnerApprovalPin({ pin: body.approval_pin, tenantId: auth.tenantId!, branchId }) : needsApproval ? await requireApprovalPin({ pin: body.approval_pin, tenantId: auth.tenantId!, branchId }) : { approved: true };
    if ((needsApproval || needsOwnerApproval) && !approval.approved) return fail(needsOwnerApproval ? "owner_pin_required" : "approval_pin_required", needsOwnerApproval ? "Owner PIN approval is required to grant staff cancel-bill authority." : "PIN approval is required to create user code or PIN.", 403);

    const supabase = getSupabaseServiceClient();
    const email = requestedEmail || `${employeeCodeInput || crypto.randomUUID()}@pos.local`.toLowerCase();
    const { data: existingProfile, error: existingError } = await supabase.from("users_profiles").select("id").eq("email", email).maybeSingle<{ id: string }>();
    if (existingError) return fail("user_lookup_failed", existingError.message, 500);

    if (employeeCodeInput) {
      try {
        const employeeCodeOwner = await findEmployeeCodeOwner({ tenantId: auth.tenantId!, employeeCode: employeeCodeInput });
        if (employeeCodeOwner && employeeCodeOwner !== existingProfile?.id) return fail("employee_code_duplicate", "This employee code is already assigned to another POS user.", 409);
      } catch (error) {
        return fail("employee_code_check_failed", error instanceof Error ? error.message : "Unable to verify employee code.", 500);
      }
    }

    let userId = existingProfile?.id ?? "";
    let createdAuthUserId: string | null = null;
    if (!userId) {
      const tempPassword = crypto.randomBytes(24).toString("base64url");
      const { data: authUserResult, error: authCreateError } = await supabase.auth.admin.createUser({ email, password: tempPassword, email_confirm: true, user_metadata: { full_name: fullName, platform_role: "tenant_user", source: "pos_users" } });
      if (authCreateError || !authUserResult.user?.id) return fail("auth_user_create_failed", authCreateError?.message ?? "Unable to create Supabase Auth user.", 500);
      userId = authUserResult.user.id;
      createdAuthUserId = userId;
      const pinHash = role === "staff" ? null : pin ? await bcrypt.hash(pin, 10) : null;
      const { error: insertProfileError } = await supabase.from("users_profiles").insert({ id: userId, email, full_name: fullName, platform_role: "tenant_user", pin_hash: pinHash, is_active: body.is_active ?? true });
      if (insertProfileError) {
        await supabase.auth.admin.deleteUser(userId).catch(() => undefined);
        return fail("user_create_failed", insertProfileError.message, 500);
      }
    } else {
      const profileUpdate: { full_name: string; email: string; is_active: boolean; pin_hash?: string | null } = { full_name: fullName, email, is_active: body.is_active ?? true };
      if (role !== "staff" && pin) profileUpdate.pin_hash = await bcrypt.hash(pin, 10);
      const { error: updateProfileError } = await supabase.from("users_profiles").update(profileUpdate).eq("id", userId);
      if (updateProfileError) return fail("user_profile_update_failed", updateProfileError.message, 500);
    }

    const employeeCode = employeeCodeInput;
    try {
      const employeeCodeOwner = await findEmployeeCodeOwner({ tenantId: auth.tenantId!, employeeCode });
      if (employeeCodeOwner && employeeCodeOwner !== userId) {
        if (createdAuthUserId) await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
        return fail("employee_code_duplicate", "This employee code is already assigned to another POS user.", 409);
      }
    } catch (error) {
      if (createdAuthUserId) await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
      return fail("employee_code_check_failed", error instanceof Error ? error.message : "Unable to verify employee code.", 500);
    }

    const { error: roleError } = await supabase.from("user_branch_roles").upsert({ user_id: userId, tenant_id: auth.tenantId!, branch_id: branchId, role, is_default: false }, { onConflict: "user_id,tenant_id,branch_id" });
    if (roleError) {
      if (createdAuthUserId) await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
      return fail("user_role_create_failed", roleError.message, 500);
    }

    try {
      await upsertProfileSettings({ tenantId: auth.tenantId!, userId, employeeCode, positionTitle, permissionRole });
    } catch (error) {
      if (createdAuthUserId) await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
      if (isDuplicateEmployeeCodeError(error as { code?: string | null; message?: string | null })) return fail("employee_code_duplicate", "This employee code is already assigned to another POS user.", 409);
      return fail("pos_user_profile_create_failed", error instanceof Error ? error.message : "Unable to create POS user profile.", 500);
    }

    const scopeWrite = await supabase.from("pos_user_device_scopes").upsert({ user_id: userId, tenant_id: auth.tenantId!, branch_id: branchId, scope_mode: scopeMode, device_id: scopeMode === "single_device" ? deviceId : null }, { onConflict: "tenant_id,branch_id,user_id" });
    if (scopeWrite.error && !isMissingRelationError(scopeWrite.error, "pos_user_device_scopes")) {
      if (createdAuthUserId) await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
      return fail("pos_user_scope_create_failed", scopeWrite.error.message, 500);
    }

    if (canApproveCancelBill) {
      const pinHash = await bcrypt.hash(pin, 10);
      const { error: permissionError } = await supabase.rpc("configure_staff_cancel_bill_approval", { p_tenant_id: auth.tenantId!, p_branch_id: branchId, p_user_id: userId, p_is_enabled: true, p_pin_hash: pinHash, p_granted_by: auth.userId });
      if (permissionError) {
        if (createdAuthUserId) await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
        if (isMissingRpcError(permissionError, "configure_staff_cancel_bill_approval")) return fail("staff_approval_table_missing", "Staff approval permission table is missing. Please run Supabase migrations.", 500);
        return fail("staff_approval_create_failed", permissionError.message, 500);
      }
    }

    void appendAuditLog({ tenantId: auth.tenantId!, branchId, actorUserId: auth.userId, actorRole: auth.branchRole ?? "manager", targetUserId: userId, action: "pos_user_created", targetTable: "users_profiles", targetId: userId, metadata: { role, employee_code: employeeCode, position_title: positionTitle, reused_profile: Boolean(existingProfile), can_approve_cancel_bill: canApproveCancelBill } });
    return ok({ user_id: userId, branch_id: branchId, role }, 201);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    if (error instanceof Error && error.message === "forbidden_branch_scope") return fail("forbidden_branch_scope", "Cross-branch access is not allowed.", 403);
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await getPosUsersAuthContext("users:manage");
    if (!canActorDelete(auth.branchRole)) return fail("forbidden_role", "Only owner can delete POS users.", 403);
    const { searchParams } = new URL(request.url);
    const userId = String(searchParams.get("user_id") ?? "").trim();
    const branchId = resolveSessionBranchId(auth, searchParams.get("branch_id"));
    if (!userId || !branchId) return fail("invalid_payload", "user_id and branch_id are required.", 422);
    if (userId === auth.userId) return fail("delete_self_forbidden", "Owner cannot delete own active access.", 409);
    const supabase = getSupabaseServiceClient();
    const targetRole = await getTargetRole({ tenantId: auth.tenantId!, branchId, userId });
    if (!targetRole) return fail("user_not_found", "User was not found in this branch.", 404);
    const deleteScope = await supabase.from("pos_user_device_scopes").delete().eq("tenant_id", auth.tenantId!).eq("branch_id", branchId).eq("user_id", userId);
    if (deleteScope.error && !isMissingRelationError(deleteScope.error, "pos_user_device_scopes")) return fail("pos_user_scope_delete_failed", deleteScope.error.message, 500);
    const { error: deleteRoleError } = await supabase.from("user_branch_roles").delete().eq("tenant_id", auth.tenantId!).eq("branch_id", branchId).eq("user_id", userId);
    if (deleteRoleError) return fail("user_delete_failed", deleteRoleError.message, 500);
    const { count } = await supabase.from("user_branch_roles").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if ((count ?? 0) === 0) await supabase.from("users_profiles").update({ is_active: false }).eq("id", userId);
    void appendAuditLog({ tenantId: auth.tenantId!, branchId, actorUserId: auth.userId, actorRole: "owner", targetUserId: userId, action: "pos_user_deleted", targetTable: "user_branch_roles", targetId: userId, metadata: { target_role: targetRole } });
    return ok({ user_id: userId, branch_id: branchId, deleted: true });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    if (error instanceof Error && error.message === "forbidden_branch_scope") return fail("forbidden_branch_scope", "Cross-branch access is not allowed.", 403);
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

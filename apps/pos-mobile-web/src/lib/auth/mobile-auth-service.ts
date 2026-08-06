import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { createMobileFlow, type MobileLoginFlow } from "@/lib/auth/mobile-flow";
import { getEnv } from "@/lib/env";
import type { BranchRole } from "@/types/contracts";

type BranchRow = { id: string; code: string | null; name: string | null; is_active: boolean };
type TenantRow = { id: string; code: string; name: string; is_active: boolean };
type UserProfileRow = { id: string; email: string | null; full_name: string | null; is_active: boolean };
export type BranchDeviceRow = {
  id: string;
  device_code: string | null;
  device_name: string | null;
  device_type: string | null;
  status: string | null;
  is_locked: boolean | null;
};

type UserRoleRow = {
  user_id: string;
  role: BranchRole;
  users_profiles: UserProfileRow | UserProfileRow[] | null;
};

function normalizeEmployeeCode(value: string) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeDigits(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

function deriveEmployeeCode(userId: string) {
  return `EMP-${String(userId).replace(/-/g, "").toUpperCase().slice(-6)}`;
}

function employeeCandidates(input: string) {
  const normalized = normalizeEmployeeCode(input);
  const digits = normalizeDigits(normalized);
  const set = new Set<string>();
  if (normalized) set.add(normalized);
  if (digits) {
    const last6 = digits.slice(-6);
    const padded = last6.padStart(6, "0");
    set.add(last6);
    set.add(padded);
    set.add(`EMP-${last6}`);
    set.add(`EMP-${padded}`);
  }
  return set;
}

function roleToPermissions(role: BranchRole) {
  if (role === "owner" || role === "manager") {
    return ["pos.sales.access", "pos.device.override_in_use", "pos.shift.open", "pos.sales.refund", "pos.sales.discount", "pos.sales.void", "pos.reports.view"];
  }
  if (role === "accountant") return ["pos.sales.access", "pos.reports.view"];
  return ["pos.sales.access", "pos.shift.open"];
}

function isDeviceSelectable(device: BranchDeviceRow) {
  const status = String(device.status ?? "active").toLowerCase();
  return device.is_locked !== true && !["disabled", "inactive", "locked", "maintenance"].includes(status);
}

function loginContextExpiresAt() {
  return new Date(Date.now() + getEnv().MOBILE_LOGIN_CONTEXT_TTL_MINUTES * 60 * 1000).toISOString();
}

async function loadEmployeeCodes(tenantId: string, userIds: string[]) {
  const supabase = createServiceClient();
  const map = new Map<string, string>();
  if (!userIds.length) return map;
  const { data, error } = await supabase.from("pos_user_profiles").select("user_id,employee_code").eq("tenant_id", tenantId).in("user_id", userIds);
  if (error) return map;
  for (const row of (data ?? []) as Array<{ user_id: string; employee_code: string | null }>) {
    if (row.employee_code) map.set(row.user_id, normalizeEmployeeCode(row.employee_code));
  }
  return map;
}

export async function verifyStoreCode(storeCode: string) {
  const supabase = createServiceClient();
  const code = storeCode.trim().toUpperCase();
  const { data: tenant, error: tenantError } = await supabase.from("tenants").select("id,code,name,is_active").eq("code", code).maybeSingle<TenantRow>();
  if (tenantError || !tenant || tenant.is_active === false) return null;

  const { data: branches, error: branchError } = await supabase
    .from("branches")
    .select("id,code,name,is_active")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (branchError) throw new Error(branchError.message);

  const branchRows = ((branches ?? []) as BranchRow[]).filter((branch) => Boolean(branch.id));
  if (branchRows.length === 0) return null;
  let contextId = "";
  if (branchRows.length === 1) {
    const { data: context, error: contextError } = await supabase
      .from("pos_login_contexts")
      .insert({
        tenant_id: tenant.id,
        branch_id: branchRows[0].id,
        store_code: tenant.code,
        status: "active",
        expires_at: loginContextExpiresAt(),
        metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web" }
      })
      .select("id")
      .single<{ id: string }>();
    if (contextError || !context) throw new Error(contextError?.message ?? "login_context_create_failed");
    contextId = context.id;
  }

  const flow = createMobileFlow({
    stage: branchRows.length === 1 ? "branch_selected" : "store_verified",
    contextId,
    tenantId: tenant.id,
    tenantCode: tenant.code,
    tenantName: tenant.name,
    branchId: branchRows.length === 1 ? branchRows[0].id : null,
    branchCode: branchRows.length === 1 ? branchRows[0].code : null,
    branchName: branchRows.length === 1 ? branchRows[0].name : null
  });

  return { flow, tenant: { id: tenant.id, code: tenant.code, name: tenant.name }, branches: branchRows, nextStep: branchRows.length === 1 ? "employee" : "branch" };
}

export async function listBranches(flow: MobileLoginFlow) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("branches").select("id,code,name,is_active").eq("tenant_id", flow.tenantId).eq("is_active", true).order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BranchRow[];
}

export async function selectBranch(flow: MobileLoginFlow, branchId: string) {
  const branches = await listBranches(flow);
  const branch = branches.find((item) => item.id === branchId);
  if (!branch) return null;
  const supabase = createServiceClient();
  let contextId = flow.contextId;
  if (contextId) {
    await supabase.from("pos_login_contexts").update({ branch_id: branch.id }).eq("id", contextId).eq("tenant_id", flow.tenantId).eq("status", "active");
  } else {
    const { data: context, error } = await supabase
      .from("pos_login_contexts")
      .insert({
        tenant_id: flow.tenantId,
        branch_id: branch.id,
        store_code: flow.tenantCode,
        status: "active",
        expires_at: loginContextExpiresAt(),
        metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web" }
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !context) throw new Error(error?.message ?? "login_context_create_failed");
    contextId = context.id;
  }
  return createMobileFlow({ ...flow, stage: "branch_selected", contextId, branchId: branch.id, branchCode: branch.code, branchName: branch.name });
}

export async function verifyEmployeeCode(flow: MobileLoginFlow, employeeCode: string) {
  if (!flow.branchId || flow.stage !== "branch_selected") return null;
  const supabase = createServiceClient();
  const candidates = employeeCandidates(employeeCode);

  const { data, error } = await supabase
    .from("user_branch_roles")
    .select("user_id,role,users_profiles!inner(id,email,full_name,is_active)")
    .eq("tenant_id", flow.tenantId)
    .eq("branch_id", flow.branchId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as UserRoleRow[];
  const codeByUser = await loadEmployeeCodes(flow.tenantId, rows.map((row) => row.user_id));
  for (const row of rows) {
    const profile = Array.isArray(row.users_profiles) ? row.users_profiles[0] : row.users_profiles;
    if (!profile?.is_active) continue;
    const customCode = codeByUser.get(profile.id) ?? "";
    const derivedCode = deriveEmployeeCode(profile.id);
    const email = normalizeEmployeeCode(profile.email ?? "");
    const emailLocal = email.includes("@") ? email.split("@")[0] : email;
    const matchedCode = candidates.has(customCode) || candidates.has(derivedCode) || candidates.has(normalizeDigits(customCode).slice(-6)) || candidates.has(normalizeDigits(derivedCode).slice(-6)) || candidates.has(email) || candidates.has(emailLocal);
    if (!matchedCode) continue;

    const matchedEmployeeCode = customCode || derivedCode;
    const nextFlow = createMobileFlow({
      stage: "employee_verified",
      contextId: flow.contextId,
      tenantId: flow.tenantId,
      tenantCode: flow.tenantCode,
      tenantName: flow.tenantName,
      branchId: flow.branchId,
      branchCode: flow.branchCode,
      branchName: flow.branchName,
      userId: profile.id,
      employeeCode: matchedEmployeeCode,
      employeeName: profile.full_name ?? matchedEmployeeCode,
      role: row.role
    });

    return {
      flow: nextFlow,
      user: { id: profile.id, name: profile.full_name ?? (customCode || derivedCode) },
      role: row.role,
      permissions: roleToPermissions(row.role)
    };
  }

  return null;
}

export async function listBranchDevices(flow: MobileLoginFlow) {
  if (!flow.branchId) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("branch_devices")
    .select("id,device_code,device_name,device_type,status,is_locked")
    .eq("tenant_id", flow.tenantId)
    .eq("branch_id", flow.branchId)
    .order("device_name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BranchDeviceRow[]).filter(isDeviceSelectable);
}

type ActivePosSessionRow = {
  id: string;
  role: BranchRole;
  device_id: string | null;
  device_code: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
};

function isUniqueConflictError(error: unknown) {
  const typed = error as { code?: string; message?: string } | null;
  const message = String(typed?.message ?? "").toLowerCase();
  return typed?.code === "23505" || message.includes("duplicate key value") || message.includes("unique constraint");
}

async function findReusableActiveSession(args: {
  tenantId: string;
  branchId: string;
  userId: string;
  deviceId: string;
  deviceCode: string;
}) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("pos_sessions")
    .select("id,role,device_id,device_code,expires_at,metadata")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("user_id", args.userId)
    .eq("status", "active")
    .or(`device_id.eq.${args.deviceId},device_code.eq.${args.deviceCode}`)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle<ActivePosSessionRow>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data;
}

export async function selectDeviceAndCreateSession(flow: MobileLoginFlow, deviceId: string) {
  if (!flow.branchId || !flow.userId || !flow.role || flow.stage !== "employee_verified") return null;
  const devices = await listBranchDevices(flow);
  const device = devices.find((item) => item.id === deviceId);
  if (!device?.device_code) return null;

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getEnv().MOBILE_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  async function consumeLoginContext() {
    if (!flow.contextId) return;
    await supabase
      .from("pos_login_contexts")
      .update({ status: "consumed", consumed_at: nowIso })
      .eq("id", flow.contextId)
      .eq("tenant_id", flow.tenantId);
  }

  const sessionPayload = {
    tenant_id: flow.tenantId,
    branch_id: flow.branchId,
    device_id: device.id,
    device_code: device.device_code,
    user_id: flow.userId,
    role: flow.role,
    login_context_id: flow.contextId,
    login_method: "employee_code",
    status: "active",
    expires_at: expiresAt,
    metadata: {
      source_app: "CpIPOS Mobile",
      source_channel: "mobile_web",
      employee_code: flow.employeeCode,
      device_name: device.device_name,
      allow_parallel_web_mobile: true,
    },
  };

  const { data: createdSession, error: sessionError } = await supabase
    .from("pos_sessions")
    .insert(sessionPayload)
    .select("id")
    .single<{ id: string }>();

  let sessionId = createdSession?.id ?? "";
  let reusedExistingSession = false;

  if (sessionError || !createdSession) {
    if (!isUniqueConflictError(sessionError)) throw new Error(sessionError?.message ?? "session_create_failed");
    const reusable = await findReusableActiveSession({
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      userId: flow.userId,
      deviceId: device.id,
      deviceCode: device.device_code,
    });
    if (!reusable?.id) throw new Error(sessionError?.message ?? "session_scope_conflict");
    sessionId = reusable.id;
    reusedExistingSession = true;
  }

  await consumeLoginContext();

  const { data: openShift, error: shiftError } = await supabase
    .from("shifts")
    .select("id")
    .eq("tenant_id", flow.tenantId)
    .eq("branch_id", flow.branchId)
    .eq("device_code", device.device_code)
    .eq("opened_by", flow.userId)
    .eq("status", "open")
    .maybeSingle<{ id: string }>();
  if (shiftError) throw new Error(shiftError.message);

  await appendMobileAuditLog({
    tenantId: flow.tenantId,
    branchId: flow.branchId,
    actorUserId: flow.userId,
    actorRole: flow.role,
    action: reusedExistingSession ? "mobile_session_reused_for_parallel_web" : "mobile_session_created",
    targetTable: "pos_sessions",
    targetId: sessionId,
    module: "auth",
    entityType: "pos_sessions",
    entityId: sessionId,
    deviceCode: device.device_code,
    posSessionId: sessionId,
    metadata: {
      source_app: "CpIPOS Mobile",
      source_channel: "mobile_web",
      employee_code: flow.employeeCode,
      device_id: device.id,
      device_name: device.device_name,
      reused_existing_session: reusedExistingSession,
      has_open_shift: Boolean(openShift),
      note: "Mobile login does not revoke main web POS sessions.",
    },
  });

  return {
    sessionId,
    reusedExistingSession,
    hasOpenShift: Boolean(openShift),
    user: { id: flow.userId, name: flow.employeeName ?? flow.employeeCode ?? flow.userId },
    role: flow.role,
    permissions: roleToPermissions(flow.role),
    device: {
      id: device.id,
      code: device.device_code,
      name: device.device_name
    }
  };
}
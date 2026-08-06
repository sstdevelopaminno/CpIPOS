import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { releaseDineInTable } from "@/lib/sales/mobile-dine-in-service";
import { createServiceClient } from "@/lib/supabase/server";
import { voidPinSchema } from "@/lib/validation/auth";
import { z } from "zod";

const cancelSchema = z.object({
  orderId: z.string().uuid(),
  pin: voidPinSchema,
});

type RoleRow = {
  user_id: string;
  role: string;
  users_profiles: { id: string; email: string | null; is_active: boolean } | { id: string; email: string | null; is_active: boolean }[] | null;
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

async function hasVoidPin(tenantId: string, branchId: string, pin: string) {
  const supabase = createServiceClient();
  const candidates = employeeCandidates(pin);
  const { data: roles, error: roleError } = await supabase
    .from("user_branch_roles")
    .select("user_id,role,users_profiles!inner(id,email,is_active)")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .in("role", ["owner", "manager"]);
  if (roleError) throw new Error(roleError.message);

  const rows = (roles ?? []) as RoleRow[];
  const userIds = rows.map((row) => row.user_id);
  const codeByUser = new Map<string, string>();
  if (userIds.length) {
    const { data: codes } = await supabase.from("pos_user_profiles").select("user_id,employee_code").eq("tenant_id", tenantId).in("user_id", userIds);
    for (const row of (codes ?? []) as Array<{ user_id: string; employee_code: string | null }>) {
      if (row.employee_code) codeByUser.set(row.user_id, normalizeEmployeeCode(row.employee_code));
    }
  }

  return rows.some((row) => {
    const profile = Array.isArray(row.users_profiles) ? row.users_profiles[0] : row.users_profiles;
    if (!profile?.is_active) return false;
    const customCode = codeByUser.get(profile.id) ?? "";
    const derivedCode = deriveEmployeeCode(profile.id);
    const email = normalizeEmployeeCode(profile.email ?? "");
    const emailLocal = email.includes("@") ? email.split("@")[0] : email;
    return (
      candidates.has(customCode) ||
      candidates.has(derivedCode) ||
      candidates.has(normalizeDigits(customCode).slice(-6)) ||
      candidates.has(normalizeDigits(derivedCode).slice(-6)) ||
      candidates.has(email) ||
      candidates.has(emailLocal)
    );
  });
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์", 403);

    const body = cancelSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลยกเลิกบิลไม่ถูกต้อง", 422);

    const allowed = await hasVoidPin(scope.tenantId, scope.branchId, body.data.pin);
    if (!allowed) return fail("invalid_pin", "PIN ไม่ถูกต้องหรือไม่มีสิทธิ์ยกเลิก", 403);

    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();
    const { data: order, error: orderLookupError } = await supabase
      .from("orders")
      .select("id,order_no,table_id,metadata")
      .eq("id", body.data.orderId)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("order_type", "dine_in")
      .eq("status", "draft")
      .maybeSingle<{ id: string; order_no: string; table_id: string | null; metadata: Record<string, unknown> | null }>();
    if (orderLookupError) throw new Error(orderLookupError.message);
    if (!order?.table_id) return fail("order_not_found", "ไม่พบ draft bill ของโต๊ะนี้", 404);

    const { data, error } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        updated_at: nowIso,
        metadata: { ...(order.metadata ?? {}), source_app: "CpIPOS Mobile", source_channel: "mobile_web", mode: "dine_in", hold_state: "cancelled", voided_from: "mobile_dine_in", voided_by: scope.userId, voided_at: nowIso },
      })
      .eq("id", order.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("status", "draft")
      .select("id,order_no")
      .maybeSingle<{ id: string; order_no: string }>();
    if (error) throw new Error(error.message);
    if (!data) return fail("order_not_found", "ไม่พบ draft bill ของโต๊ะนี้", 404);

    await releaseDineInTable(supabase, scope, order.table_id, "cancelled", order.id);

    await appendMobileAuditLog({
      scope,
      action: "mobile_dine_in_bill_cancelled",
      targetTable: "orders",
      targetId: data.id,
      metadata: { order_no: data.order_no, table_id: order.table_id, mode: "dine_in" },
      afterData: { status: "cancelled", hold_state: "cancelled", table_id: order.table_id },
    });

    return ok({ cancelled: true, orderId: data.id, orderNo: data.order_no, redirectTo: "/sales/table" });
  } catch (error) {
    console.error("[dine-in.cancel]", error);
    return fail("cancel_failed", "ยกเลิกบิลโต๊ะไม่สำเร็จ", 503);
  }
}


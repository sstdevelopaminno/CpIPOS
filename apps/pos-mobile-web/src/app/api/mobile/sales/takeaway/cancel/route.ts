import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
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
    if (!scope) return fail("missing_session", "\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "\u0e44\u0e21\u0e48\u0e21\u0e35\u0e2a\u0e34\u0e17\u0e18\u0e34\u0e4c", 403);

    const body = cancelSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e1a\u0e34\u0e25\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07", 422);

    const allowed = await hasVoidPin(scope.tenantId, scope.branchId, body.data.pin);
    if (!allowed) return fail("invalid_pin", "PIN \u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07\u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48\u0e21\u0e35\u0e2a\u0e34\u0e17\u0e18\u0e34\u0e4c\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01", 403);

    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();
    const { data: order, error: orderLookupError } = await supabase
      .from("orders")
      .select("id,order_no,metadata")
      .eq("id", body.data.orderId)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("pos_session_id", scope.sessionId)
      .eq("order_type", "takeaway")
      .eq("status", "draft")
      .maybeSingle<{ id: string; order_no: string; metadata: Record<string, unknown> | null }>();
    if (orderLookupError) throw new Error(orderLookupError.message);
    if (!order) return fail("order_not_found", "\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25 draft \u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01", 404);

    const { data, error } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        updated_at: nowIso,
        metadata: { ...(order.metadata ?? {}), source_app: "CpIPOS Mobile", source_channel: "mobile_web", mode: "takeaway", hold_state: "cancelled", voided_from: "mobile_takeaway", voided_by: scope.userId, voided_at: nowIso },
      })
      .eq("id", order.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("status", "draft")
      .select("id,order_no")
      .maybeSingle<{ id: string; order_no: string }>();
    if (error) throw new Error(error.message);
    if (!data) return fail("order_not_found", "\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25 draft \u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01", 404);

    await appendMobileAuditLog({
      scope,
      action: "mobile_takeaway_bill_cancelled",
      targetTable: "orders",
      targetId: data.id,
      metadata: { order_no: data.order_no, mode: "takeaway" },
      afterData: { status: "cancelled", hold_state: "cancelled" },
    });

    return ok({ cancelled: true, orderId: data.id, orderNo: data.order_no, redirectTo: "/sales" });
  } catch (error) {
    console.error("[takeaway.cancel]", error);
    return fail("cancel_failed", "\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e1a\u0e34\u0e25\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08", 503);
  }
}

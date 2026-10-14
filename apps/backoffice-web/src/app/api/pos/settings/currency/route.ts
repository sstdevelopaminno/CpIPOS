import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { getCustomPosCurrencyContext } from "@/lib/server/custom-pos-currency";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    const ctx = await getCustomPosCurrencyContext(auth.tenantId!);
    if (!ctx.enabled) return fail("custom_currency_not_enabled", "Currency settings require an IT-authorized CUSTOM package.", 403);
    return ok({ currency_code: ctx.currency_code, available_currencies: ["THB", "LAK"] });
  } catch {
    return fail("currency_settings_unavailable", "Unable to load currency settings.", 500);
  }
}
export async function PATCH(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    if (auth.branchRole !== "owner") return fail("forbidden_role", "Only the owner may change the POS currency.", 403);
    const body = await request.json().catch(() => null);
    if (body?.currency_code !== "THB" && body?.currency_code !== "LAK")
      return fail("invalid_currency", "Supported sales currencies: THB, LAK.", 422);
    const ctx = await getCustomPosCurrencyContext(auth.tenantId!);
    if (!ctx.enabled || !ctx.contract) return fail("custom_currency_not_enabled", "IT must enable the CUSTOM currency menu first.", 403);
    if (ctx.currency_code === body.currency_code) return ok({ currency_code: ctx.currency_code });
    const admin = getSupabaseServiceClient();
    const { count, error: orderError } = await admin.from("orders")
      .select("id", { count: "exact", head: true }).eq("tenant_id", auth.tenantId!);
    if (orderError) throw new Error("pos_currency_history_check_failed");
    if ((count ?? 0) > 0) return fail("currency_change_requires_migration", "ร้านมีประวัติการขายแล้ว กรุณาให้ฝ่าย IT ไปที่ Tenants / Stores → เปิดปิดเมนูหลัก → ตั้งค่าสกุลเงิน (CUSTOM) เพื่อตรวจบิลและอนุมัติ", 409);
    const existing = ctx.contract.metadata && typeof ctx.contract.metadata === "object" && !Array.isArray(ctx.contract.metadata)
      ? ctx.contract.metadata as Record<string, unknown> : {};
    const { data: updated, error: writeError } = await admin.from("tenant_subscription_contracts")
      .update({ metadata: { ...existing, pos_currency_code: body.currency_code } })
      .eq("tenant_id", auth.tenantId!).eq("id", ctx.contract.id)
      .eq("updated_at", ctx.contract.updated_at).select("id").maybeSingle();
    if (writeError) throw new Error("pos_currency_update_failed");
    if (!updated) return fail("currency_settings_conflict", "Settings changed concurrently. Refresh and retry.", 409);
    await appendAuditLog({ tenantId: auth.tenantId!, branchId: auth.branchId!, actorUserId: auth.userId, actorRole: auth.branchRole,
      action: "custom_pos_currency_changed", targetTable: "tenant_subscription_contracts", targetId: ctx.contract.id,
      metadata: { previous: ctx.currency_code, currency_code: body.currency_code } });
    return ok({ currency_code: body.currency_code });
  } catch {
    return fail("currency_settings_failed", "Unable to update sales currency.", 500);
  }
}

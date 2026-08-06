import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const modeSchema = z.enum(["manual", "amount_rate", "fixed_per_bill"]);

const settingsSchema = z.object({
  pointsMode: modeSchema,
  amountPerPoint: z.coerce.number().positive().max(1_000_000),
  pointsPerAmount: z.coerce.number().int().min(0).max(1_000_000),
  fixedPointsPerBill: z.coerce.number().int().min(0).max(1_000_000),
  stampsMode: modeSchema,
  amountPerStamp: z.coerce.number().positive().max(1_000_000),
  stampsPerAmount: z.coerce.number().int().min(0).max(1_000_000),
  fixedStampsPerBill: z.coerce.number().int().min(0).max(1_000_000),
  qrEnabled: z.boolean(),
  qrTokenTtlMinutes: z.coerce.number().int().min(1).max(1440),
});

type SettingsRow = {
  points_mode: "manual" | "amount_rate" | "fixed_per_bill" | null;
  amount_per_point: number | null;
  points_per_amount: number | null;
  fixed_points_per_bill: number | null;
  stamps_mode: "manual" | "amount_rate" | "fixed_per_bill" | null;
  amount_per_stamp: number | null;
  stamps_per_amount: number | null;
  fixed_stamps_per_bill: number | null;
  qr_enabled: boolean | null;
  qr_token_ttl_minutes: number | null;
};

const defaultSettings = {
  pointsMode: "amount_rate" as const,
  amountPerPoint: 100,
  pointsPerAmount: 1,
  fixedPointsPerBill: 0,
  stampsMode: "manual" as const,
  amountPerStamp: 100,
  stampsPerAmount: 1,
  fixedStampsPerBill: 0,
  qrEnabled: true,
  qrTokenTtlMinutes: 15,
};

function normalizeSettings(row?: SettingsRow | null) {
  if (!row) return defaultSettings;
  return {
    pointsMode: row.points_mode ?? defaultSettings.pointsMode,
    amountPerPoint: Number(row.amount_per_point ?? defaultSettings.amountPerPoint),
    pointsPerAmount: Number(row.points_per_amount ?? defaultSettings.pointsPerAmount),
    fixedPointsPerBill: Number(row.fixed_points_per_bill ?? defaultSettings.fixedPointsPerBill),
    stampsMode: row.stamps_mode ?? defaultSettings.stampsMode,
    amountPerStamp: Number(row.amount_per_stamp ?? defaultSettings.amountPerStamp),
    stampsPerAmount: Number(row.stamps_per_amount ?? defaultSettings.stampsPerAmount),
    fixedStampsPerBill: Number(row.fixed_stamps_per_bill ?? defaultSettings.fixedStampsPerBill),
    qrEnabled: Boolean(row.qr_enabled ?? defaultSettings.qrEnabled),
    qrTokenTtlMinutes: Number(row.qr_token_ttl_minutes ?? defaultSettings.qrTokenTtlMinutes),
  };
}

function isMissingSettingsTable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("mobile_member_settings") && (message.includes("schema cache") || message.includes("does not exist"));
}

export async function GET() {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);

    const { data, error } = await createServiceClient()
      .from("mobile_member_settings")
      .select("points_mode,amount_per_point,points_per_amount,fixed_points_per_bill,stamps_mode,amount_per_stamp,stamps_per_amount,fixed_stamps_per_bill,qr_enabled,qr_token_ttl_minutes")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .maybeSingle<SettingsRow>();

    if (error) throw new Error(error.message);
    return ok({ settings: normalizeSettings(data) });
  } catch (error) {
    console.error("[mobile.members.settings.GET]", error);
    if (isMissingSettingsTable(error)) return fail("members_schema_missing", "ยังไม่ได้สร้างตารางตั้งค่าสมาชิกใน Supabase", 501);
    return fail("member_settings_load_failed", "โหลดตั้งค่าสมาชิกไม่สำเร็จ", 503);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);

    const body = settingsSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลตั้งค่าสมาชิกไม่ถูกต้อง", 422);

    const nowIso = new Date().toISOString();
    const payload = {
      tenant_id: scope.tenantId,
      branch_id: scope.branchId,
      points_mode: body.data.pointsMode,
      amount_per_point: body.data.amountPerPoint,
      points_per_amount: body.data.pointsPerAmount,
      fixed_points_per_bill: body.data.fixedPointsPerBill,
      stamps_mode: body.data.stampsMode,
      amount_per_stamp: body.data.amountPerStamp,
      stamps_per_amount: body.data.stampsPerAmount,
      fixed_stamps_per_bill: body.data.fixedStampsPerBill,
      qr_enabled: body.data.qrEnabled,
      qr_token_ttl_minutes: body.data.qrTokenTtlMinutes,
      updated_at: nowIso,
    };

    const { data, error } = await createServiceClient()
      .from("mobile_member_settings")
      .upsert(payload, { onConflict: "tenant_id,branch_id" })
      .select("points_mode,amount_per_point,points_per_amount,fixed_points_per_bill,stamps_mode,amount_per_stamp,stamps_per_amount,fixed_stamps_per_bill,qr_enabled,qr_token_ttl_minutes")
      .single<SettingsRow>();

    if (error) throw new Error(error.message);
    const normalized = normalizeSettings(data);
    await appendMobileAuditLog({
      scope,
      action: "mobile_member_settings_saved",
      targetTable: "mobile_member_settings",
      targetId: `${scope.tenantId}:${scope.branchId}`,
      metadata: normalized,
      afterData: normalized,
    });
    return ok({ settings: normalized });
  } catch (error) {
    console.error("[mobile.members.settings.POST]", error);
    if (isMissingSettingsTable(error)) return fail("members_schema_missing", "ยังไม่ได้สร้างตารางตั้งค่าสมาชิกใน Supabase", 501);
    return fail("member_settings_save_failed", "บันทึกตั้งค่าสมาชิกไม่สำเร็จ", 503);
  }
}

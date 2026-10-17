import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/audit-log";
import {
  PosGuardError,
  getTenantBranchScopeFromSession,
  requirePermission,
  requirePosSession,
  updateCachedPosSessionShift,
  withPosSessionCookie
} from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getOpticalShiftUiPolicy } from "@/lib/server/optical-shift-ui-policy";
import { resolveOpticalDailyShift } from "@/lib/pos-optical-daily-shift";

function isMissingSessionShiftColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (message.includes("pos_sessions.shift_id") || message.includes("column shift_id")) return true;
  return message.includes("could not find the 'shift_id' column");
}

function isMissingShiftDeviceCodeColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (message.includes("shifts.device_code") || message.includes("column device_code")) return true;
  return message.includes("could not find the 'device_code' column");
}

function shouldUseLegacyShiftInsert(error: { message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("could not find the 'device_code' column") ||
    message.includes("could not find the 'metadata' column") ||
    message.includes("column device_code") ||
    message.includes("column metadata")
  );
}

function isUniqueViolationError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "23505" || String(error?.message ?? "").toLowerCase().includes("duplicate key value");
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "shift:open");
    const body = (await request.json().catch(() => null)) as { opening_cash?: number | string | null } | null;
    const openingCashRaw = body?.opening_cash;
    const openingCash =
      openingCashRaw === undefined || openingCashRaw === null || openingCashRaw === ""
        ? null
        : Number(openingCashRaw);
    if (openingCash !== null && (!Number.isFinite(openingCash) || openingCash < 0)) {
      return NextResponse.json(
        { data: null, error: { code: "invalid_opening_cash", message: "opening_cash must be zero or positive." } },
        { status: 422 }
      );
    }

    const sessionScope = getTenantBranchScopeFromSession(scope);
    const opticalShift=await getOpticalShiftUiPolicy(sessionScope.tenantId);
    if(opticalShift.enabled && (!opticalShift.timeZone||!opticalShift.country)) {
      return NextResponse.json({data:null,error:{code:"optical_daily_shift_policy_incomplete",message:"IT must configure Optical store timezone and country."}},{status:409});
    }
    const supabase = getSupabaseServiceClient();

    type OpenShiftSummary = {
      id: string;
      status: string;
      opened_at: string;
      opening_cash: number | null;
      device_code: string | null;
    };

    async function findExistingOpenShift() {
      let existingQuery = supabase
        .from("shifts")
        .select("id,status,opened_at,opening_cash,device_code")
        .eq("tenant_id", sessionScope.tenantId)
        .eq("branch_id", sessionScope.branchId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1);
      if (sessionScope.deviceCode) {
        existingQuery = existingQuery.eq("device_code", sessionScope.deviceCode);
      }
      let { data, error } = await existingQuery.maybeSingle<OpenShiftSummary>();
      if (isMissingShiftDeviceCodeColumnError(error)) {
        const fallbackExisting = await supabase
          .from("shifts")
          .select("id,status,opened_at,opening_cash")
          .eq("tenant_id", sessionScope.tenantId)
          .eq("branch_id", sessionScope.branchId)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle<Omit<OpenShiftSummary, "device_code">>();
        data = fallbackExisting.data ? { ...fallbackExisting.data, device_code: null } : null;
        error = fallbackExisting.error;
      }
      return { data: data ?? null, error };
    }

    async function bindSessionToShift(shiftId: string) {
      const { error } = await supabase.from("pos_sessions").update({ shift_id: shiftId }).eq("id", scope.session.id);
      if (error && !isMissingSessionShiftColumnError(error)) {
        return NextResponse.json(
          { data: null, error: { code: "session_update_failed", message: error.message } },
          { status: 500 }
        );
      }
      updateCachedPosSessionShift(scope.session.id, shiftId);
      return null;
    }

    async function reuseExistingShift(existingOpenShift: OpenShiftSummary) {
      const bindErrorResponse = await bindSessionToShift(existingOpenShift.id);
      if (bindErrorResponse) return bindErrorResponse;
      const response = NextResponse.json(
        {
          data: {
            shift: existingOpenShift,
            session_shift_id: existingOpenShift.id,
            reused_existing_shift: true
          },
          error: null
        },
        { status: 200 }
      );
      return withPosSessionCookie(response, scope.session.id);
    }

    const existingLookup = await findExistingOpenShift();
    if (existingLookup.error) {
      return NextResponse.json(
        { data: null, error: { code: "shift_query_failed", message: existingLookup.error.message } },
        { status: 500 }
      );
    }
    if (existingLookup.data) {
      if(opticalShift.enabled && opticalShift.country && opticalShift.timeZone) {
        const {data:old,error:oldError}=await supabase.from("shifts")
          .select("metadata").eq("id",existingLookup.data.id)
          .eq("tenant_id",sessionScope.tenantId).eq("branch_id",sessionScope.branchId).maybeSingle();
        if(oldError||!old || (old.metadata as Record<string,unknown>|null)?.business_shift_mode!=="optical_daily") {
          return NextResponse.json({data:null,error:{code:"optical_existing_legacy_shift_requires_review",
            message:"Existing legacy shift requires manager close/reconciliation before a daily Optical shift can open."}},{status:409});
        }
        const day=resolveOpticalDailyShift({openedAt:existingLookup.data.opened_at,
          country:opticalShift.country,approvedTimeZone:opticalShift.timeZone});
        if(!day||Date.now()>=day.cutoffAt.getTime()) {
          return NextResponse.json({data:null,error:{code:"optical_existing_overdue_shift_requires_close",
            message:"Previous Optical business day is overdue; close/reconcile that shift before opening a new one."}},{status:409});
        }
      }
      return reuseExistingShift(existingLookup.data);
    }

    const createResult = await supabase
      .from("shifts")
      .insert({
        tenant_id: sessionScope.tenantId,
        branch_id: sessionScope.branchId,
        device_code: sessionScope.deviceCode,
        opened_by: sessionScope.userId,
        status: "open",
        opening_cash: openingCash,
        metadata: {
          opened_via: "pos_session_gate",
          session_id: scope.session.id,
          ...(opticalShift.enabled ? {business_shift_mode:"optical_daily",optical_timezone:opticalShift.timeZone,
            optical_country:opticalShift.country,optical_currency:opticalShift.currency}: {})
        }
      })
      .select("id,status,opened_at,opening_cash,device_code")
      .single<{ id: string; status: string; opened_at: string; opening_cash: number | null; device_code: string | null }>();

    let createdShift = createResult.data
      ? {
          ...createResult.data,
          device_code: createResult.data.device_code ?? null
        }
      : null;
    let createError = createResult.error;

    if (isMissingShiftDeviceCodeColumnError(createResult.error) || shouldUseLegacyShiftInsert(createResult.error)) {
      // Do not create an untagged Optical shift if the old DB lacks metadata.
      if(opticalShift.enabled) return NextResponse.json({data:null,error:{code:"optical_shift_metadata_required",message:"Optical shift requires the metadata-enabled shifts schema."}},{status:409});
      const legacyCreateResult = await supabase
        .from("shifts")
        .insert({
          tenant_id: sessionScope.tenantId,
          branch_id: sessionScope.branchId,
          opened_by: sessionScope.userId,
          status: "open",
          opening_cash: openingCash ?? 0
        })
        .select("id,status,opened_at,opening_cash")
        .single<{ id: string; status: string; opened_at: string; opening_cash: number | null }>();
      createdShift = legacyCreateResult.data ? { ...legacyCreateResult.data, device_code: null } : null;
      createError = legacyCreateResult.error;
    }

    if (isUniqueViolationError(createError)) {
      const conflictLookup = await findExistingOpenShift();
      if (conflictLookup.data) {
        return reuseExistingShift(conflictLookup.data);
      }
    }

    if (createError || !createdShift) {
      return NextResponse.json(
        { data: null, error: { code: "shift_open_failed", message: createError?.message ?? "Unable to open shift." } },
        { status: 500 }
      );
    }

    const bindErrorResponse = await bindSessionToShift(createdShift.id);
    if (bindErrorResponse) return bindErrorResponse;

    void appendAuditLog({
      tenantId: sessionScope.tenantId,
      branchId: sessionScope.branchId,
      actorUserId: sessionScope.userId,
      actorRole: sessionScope.role as "owner" | "manager" | "staff" | "accountant",
      action: "pos_shift_opened",
      targetTable: "shifts",
      targetId: createdShift.id,
      metadata: {
        opening_cash: createdShift.opening_cash,
        device_code: createdShift.device_code,
        pos_session_id: scope.session.id
      }
    });

    const response = NextResponse.json(
      {
        data: {
          shift: createdShift,
          session_shift_id: createdShift.id
        },
        error: null
      },
      { status: 201 }
    );
    return withPosSessionCookie(response, scope.session.id);
  } catch (error) {
    if (error instanceof PosGuardError) {
      return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { data: null, error: { code: "pos_shift_open_failed", message: error instanceof Error ? error.message : "Unknown error." } },
      { status: 500 }
    );
  }
}

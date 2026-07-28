import { NextResponse } from "next/server";
import {
  PosGuardError,
  requirePosSession,
  updateCachedPosSessionShift,
  withPosSessionCookie
} from "@/lib/pos-session-guard";
import { loadPosRuntimeDevicePolicyForSession } from "@/lib/pos-device-status";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

async function withQueryTimeout<T>(queryPromise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T | null>([
      queryPromise,
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isMissingSessionShiftColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (error.code === "42703") return true;
  if (message.includes("pos_sessions.shift_id") || message.includes("column shift_id")) return true;
  return message.includes("could not find the 'shift_id' column");
}

function isMissingShiftDeviceCodeColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (error.code === "42703") return true;
  if (message.includes("shifts.device_code") || message.includes("column device_code")) return true;
  return message.includes("could not find the 'device_code' column");
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const EMPTY_SHIFT_METRICS = {
  order_count: 0,
  cancelled_order_count: 0,
  sales_total: 0,
  cash_total: 0,
  transfer_total: 0
};

function setTimingHeaders(response: NextResponse, startedAt: number) {
  const durationMs = Date.now() - startedAt;
  response.headers.set("x-pos-api-ms", String(durationMs));
  response.headers.set("server-timing", `total;dur=${durationMs}`);
}

function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined, column: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "42703" || message.includes(`column "${column}"`) || message.includes(`.${column}`) || message.includes("does not exist");
}

async function loadShiftMetrics(args: {
  supabase: ReturnType<typeof getSupabaseServiceClient>;
  tenantId: string;
  branchId: string;
  shiftId: string | null;
}) {
  if (!args.shiftId) {
    return { metrics: { ...EMPTY_SHIFT_METRICS }, degraded: false };
  }

  const ordersQuery = await withQueryTimeout(
    Promise.resolve(
      args.supabase
        .from("orders")
        .select("id,status,total_amount,grand_total")
        .eq("tenant_id", args.tenantId)
        .eq("branch_id", args.branchId)
        .eq("shift_id", args.shiftId)
    ) as Promise<{
      data:
        | Array<{
            id: string;
            status: string;
            total_amount: number | null;
            grand_total: number | null;
          }>
        | null;
      error?: { code?: string | null; message?: string | null } | null;
    }>,
    2500
  );

  if (!ordersQuery || ordersQuery.error) {
    return { metrics: { ...EMPTY_SHIFT_METRICS }, degraded: true };
  }

  const orders = (ordersQuery.data ?? []) as Array<{
    id: string;
    status: string;
    total_amount: number | null;
    grand_total: number | null;
  }>;

  const metrics = {
    order_count: 0,
    cancelled_order_count: 0,
    sales_total: 0,
    cash_total: 0,
    transfer_total: 0
  };

  if (!ordersQuery.error) {
    for (const order of orders) {
      metrics.order_count += 1;
      if (order.status === "cancelled") {
        metrics.cancelled_order_count += 1;
      } else {
        metrics.sales_total += toNumber(order.grand_total ?? order.total_amount);
      }
    }
  }

  let paymentRows: Array<{ order_id: string | null; method: string; amount: number | null }> = [];
  const orderIds = orders.map((order) => order.id);
  let degraded = false;
  const paymentsByShift = await withQueryTimeout(
    Promise.resolve(
      args.supabase
        .from("payments")
        .select("order_id,method,amount")
        .eq("tenant_id", args.tenantId)
        .eq("branch_id", args.branchId)
        .eq("shift_id", args.shiftId)
    ) as Promise<{
      data: Array<{ order_id: string | null; method: string; amount: number | null }> | null;
      error?: { code?: string | null; message?: string | null } | null;
    }>,
    2500
  );
  if (!paymentsByShift) {
    degraded = true;
  } else if (!paymentsByShift.error) {
    paymentRows = (paymentsByShift.data ?? []) as Array<{ order_id: string | null; method: string; amount: number | null }>;
  } else if (isMissingColumnError(paymentsByShift.error, "shift_id") && orderIds.length > 0) {
    const paymentsByOrder = await withQueryTimeout(
      Promise.resolve(
        args.supabase
          .from("payments")
          .select("order_id,method,amount")
          .eq("tenant_id", args.tenantId)
          .eq("branch_id", args.branchId)
          .in("order_id", orderIds)
      ) as Promise<{
        data: Array<{ order_id: string | null; method: string; amount: number | null }> | null;
        error?: { code?: string | null; message?: string | null } | null;
      }>,
      2500
    );
    if (!paymentsByOrder) {
      degraded = true;
    } else if (!paymentsByOrder.error) {
      paymentRows = (paymentsByOrder.data ?? []) as Array<{ order_id: string | null; method: string; amount: number | null }>;
    } else if (isMissingColumnError(paymentsByOrder.error, "branch_id")) {
      const legacyPaymentsByOrder = await withQueryTimeout(
        Promise.resolve(
          args.supabase
            .from("payments")
            .select("order_id,method,amount")
            .eq("tenant_id", args.tenantId)
            .in("order_id", orderIds)
        ) as Promise<{
          data: Array<{ order_id: string | null; method: string; amount: number | null }> | null;
          error?: { code?: string | null; message?: string | null } | null;
        }>,
        2500
      );
      if (!legacyPaymentsByOrder) {
        degraded = true;
      } else if (!legacyPaymentsByOrder.error) {
        paymentRows = (legacyPaymentsByOrder.data ?? []) as Array<{ order_id: string | null; method: string; amount: number | null }>;
      } else {
        degraded = true;
      }
    } else {
      degraded = true;
    }
  } else if (isMissingColumnError(paymentsByShift.error, "branch_id") && orderIds.length > 0) {
    const legacyPaymentsByOrder = await withQueryTimeout(
      Promise.resolve(
        args.supabase
          .from("payments")
          .select("order_id,method,amount")
          .eq("tenant_id", args.tenantId)
          .in("order_id", orderIds)
      ) as Promise<{
        data: Array<{ order_id: string | null; method: string; amount: number | null }> | null;
        error?: { code?: string | null; message?: string | null } | null;
      }>,
      2500
    );
    if (!legacyPaymentsByOrder) {
      degraded = true;
    } else if (!legacyPaymentsByOrder.error) {
      paymentRows = (legacyPaymentsByOrder.data ?? []) as Array<{ order_id: string | null; method: string; amount: number | null }>;
    } else {
      degraded = true;
    }
  } else {
    degraded = true;
  }

  for (const payment of paymentRows) {
    if (payment.method === "cash") {
      metrics.cash_total += toNumber(payment.amount);
    } else if (payment.method === "bank_transfer") {
      metrics.transfer_total += toNumber(payment.amount);
    }
  }

  return { metrics, degraded };
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const scope = await requirePosSession();
    const supabase = getSupabaseServiceClient();

    const shiftId = scope.session.shift_id;
    let shiftSummary: { id: string; status: string; opened_at: string; closed_at: string | null } | null = null;
    let shiftLookupFallback = false;
    let reboundShiftBinding = false;
    if (shiftId) {
      const shiftQuery = supabase
        .from("shifts")
        .select("id,status,opened_at,closed_at")
        .eq("id", shiftId)
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", scope.session.branch_id)
        .maybeSingle<{ id: string; status: string; opened_at: string; closed_at: string | null }>();
      const shiftResult = await withQueryTimeout(
        Promise.resolve(shiftQuery) as Promise<{
          data: { id: string; status: string; opened_at: string; closed_at: string | null } | null;
          error?: { code?: string; message?: string } | null;
        }>,
        3500
      );
      if (!shiftResult) {
        shiftLookupFallback = true;
      } else if (shiftResult.error) {
        shiftLookupFallback = true;
      } else {
        shiftSummary = shiftResult.data ?? null;
      }
    }

    if (!shiftSummary && !shiftId) {
      let activeShiftQuery = supabase
        .from("shifts")
        .select("id,status,opened_at,closed_at")
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", scope.session.branch_id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1);
      if (scope.session.device_code) {
        activeShiftQuery = activeShiftQuery.eq("device_code", scope.session.device_code);
      }
      let activeShiftResult = await withQueryTimeout(
        Promise.resolve(activeShiftQuery.maybeSingle<{ id: string; status: string; opened_at: string; closed_at: string | null }>()) as Promise<{
          data: { id: string; status: string; opened_at: string; closed_at: string | null } | null;
          error?: { code?: string; message?: string } | null;
        }>,
        2500
      );
      if (isMissingShiftDeviceCodeColumnError(activeShiftResult?.error)) {
        activeShiftResult = await withQueryTimeout(
          Promise.resolve(
            supabase
              .from("shifts")
              .select("id,status,opened_at,closed_at")
              .eq("tenant_id", scope.session.tenant_id)
              .eq("branch_id", scope.session.branch_id)
              .eq("status", "open")
              .order("opened_at", { ascending: false })
              .limit(1)
              .maybeSingle<{ id: string; status: string; opened_at: string; closed_at: string | null }>()
          ) as Promise<{
            data: { id: string; status: string; opened_at: string; closed_at: string | null } | null;
            error?: { code?: string; message?: string } | null;
          }>,
          2500
        );
      }
      if (!activeShiftResult) {
        shiftLookupFallback = true;
      } else if (activeShiftResult.error) {
        shiftLookupFallback = true;
      } else if (activeShiftResult.data?.id) {
        shiftSummary = activeShiftResult.data;
        const { error: bindError } = await supabase.from("pos_sessions").update({ shift_id: shiftSummary.id }).eq("id", scope.session.id);
        if (!bindError || isMissingSessionShiftColumnError(bindError)) {
          reboundShiftBinding = true;
          updateCachedPosSessionShift(scope.session.id, shiftSummary.id);
        }
      }
    }

    if (shiftLookupFallback && !shiftSummary) {
      const response = NextResponse.json(
        {
          data: null,
          error: {
            code: "shift_lookup_degraded",
            message: "Unable to confirm the active shift. Please retry."
          }
        },
        { status: 503 }
      );
      response.headers.set("x-pos-session-shift-fallback", "1");
      response.headers.set("x-pos-session-shift-rebound", reboundShiftBinding ? "1" : "0");
      setTimingHeaders(response, startedAt);
      return withPosSessionCookie(response, scope.session.id);
    }

    const [devicePolicy, shiftMetricsResult] = await Promise.all([
      loadPosRuntimeDevicePolicyForSession(scope.session),
      loadShiftMetrics({
        supabase,
        tenantId: scope.session.tenant_id,
        branchId: scope.session.branch_id,
        shiftId: shiftSummary?.status === "open" ? shiftSummary.id : null
      })
    ]);
    const response = NextResponse.json({
      data: {
        session: {
          id: scope.session.id,
          status: scope.session.status,
          expires_at: scope.session.expires_at
        },
        tenant: {
          id: scope.session.tenant_id,
          code: scope.tenant?.code ?? null,
          name: scope.tenant?.name ?? null
        },
        branch: {
          id: scope.session.branch_id,
          code: scope.branch?.code ?? null,
          name: scope.branch?.name ?? null
        },
        user: {
          id: scope.session.user_id,
          full_name: scope.user.full_name ?? scope.session.user_id
        },
        role: scope.session.role,
        permissions: scope.permissions,
        device: {
          id: scope.session.device_id,
          code: scope.session.device_code,
          name: devicePolicy.name,
          status: devicePolicy.status,
          block_sales: devicePolicy.block_sales,
          reason_code: devicePolicy.reason_code
        },
        shift: shiftSummary ? { ...shiftSummary, metrics: shiftMetricsResult.metrics } : null,
        has_active_shift: shiftSummary?.status === "open",
        shift_lookup_degraded: shiftLookupFallback,
        shift_metrics_degraded: shiftMetricsResult.degraded
      },
      error: null
    });

    response.headers.set("x-pos-session-shift-fallback", shiftLookupFallback ? "1" : "0");
    response.headers.set("x-pos-session-shift-metrics-degraded", shiftMetricsResult.degraded ? "1" : "0");
    response.headers.set("x-pos-session-shift-rebound", reboundShiftBinding ? "1" : "0");
    setTimingHeaders(response, startedAt);
    return withPosSessionCookie(response, scope.session.id);
  } catch (error) {
    if (error instanceof PosGuardError) {
      const response = NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
      setTimingHeaders(response, startedAt);
      return response;
    }
    console.error("[pos-session-current] unexpected error", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
    const response = NextResponse.json(
      { data: null, error: { code: "pos_session_current_failed", message: "Unable to load POS session." } },
      { status: 500 }
    );
    setTimingHeaders(response, startedAt);
    return response;
  }
}

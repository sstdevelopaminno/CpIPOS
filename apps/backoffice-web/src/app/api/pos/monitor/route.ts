import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { POS_GUARDS } from "@/lib/pos-resilience";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const MONITOR_CACHE_TTL_MS = 30_000;

function isSchemaMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("undefined column") ||
    normalized.includes("pgrst")
  );
}

function parseStatusCode(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  if (normalized < 100 || normalized > 599) return null;
  return normalized;
}

function parseRoute(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const route = value.trim();
  if (!route.startsWith("/")) return "unknown";
  return route.slice(0, 160);
}

export async function GET() {
  const startedAt = Date.now();
  let fallbackTenantId: string | null = null;
  let fallbackBranchId: string | null = null;

  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "monitor:view" });
    fallbackTenantId = auth.tenantId ?? null;
    fallbackBranchId = auth.branchId ?? null;

    const cacheKey = `pos-monitor:${auth.tenantId}:${auth.branchId}`;
    const { value: payload, source: cacheSource } = await readThroughRuntimeCache({
      key: cacheKey,
      ttlMs: MONITOR_CACHE_TTL_MS,
      loader: async () => {
        const supabase = getSupabaseServiceClient();
        const staleSinceIso = new Date(Date.now() - POS_GUARDS.staleQueuedMinutes * 60_000).toISOString();
        const deadLetterSinceIso = new Date(Date.now() - POS_GUARDS.deadLetterWindowMinutes * 60_000).toISOString();

        const safeCount = async (query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> => {
          const result = await query;
          if (result.error) {
            if (isSchemaMissingError(result.error.message)) {
              return 0;
            }
            throw new Error(result.error.message);
          }
          return result.count ?? 0;
        };

        const safeLatestPayment = async (): Promise<string | null> => {
          const fullResult = await supabase
            .from("orders")
            .select("payment_completed_at,updated_at")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .eq("status", "completed")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle<{ payment_completed_at: string | null; updated_at: string | null }>();
          if (!fullResult.error) {
            return fullResult.data?.payment_completed_at ?? fullResult.data?.updated_at ?? null;
          }
          if (!isSchemaMissingError(fullResult.error.message)) {
            throw new Error(fullResult.error.message);
          }

          const fallbackResult = await supabase
            .from("orders")
            .select("updated_at")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .eq("status", "completed")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle<{ updated_at: string | null }>();
          if (fallbackResult.error) {
            if (isSchemaMissingError(fallbackResult.error.message)) {
              return null;
            }
            throw new Error(fallbackResult.error.message);
          }
          return fallbackResult.data?.updated_at ?? null;
        };

        const safePerfErrorSummary = async () => {
          const { data, error } = await supabase
            .from("audit_logs")
            .select("metadata")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .eq("action", "pos_route_perf")
            .gt("created_at", deadLetterSinceIso)
            .order("created_at", { ascending: false })
            .limit(500);
          if (error) {
            if (isSchemaMissingError(error.message)) {
              return {
                total: 0,
                c4xx: 0,
                c409: 0,
                c5xx: 0,
                topRoutes: [] as Array<{ route: string; count: number }>
              };
            }
            throw new Error(error.message);
          }

          let total = 0;
          let c4xx = 0;
          let c409 = 0;
          let c5xx = 0;
          const routeMap = new Map<string, number>();
          for (const row of data ?? []) {
            const metadata = (row as { metadata?: Record<string, unknown> | null }).metadata ?? {};
            const statusCode = parseStatusCode(metadata.status_code);
            if (!statusCode || statusCode < 400) continue;
            total += 1;
            if (statusCode >= 500) c5xx += 1;
            else c4xx += 1;
            if (statusCode === 409) c409 += 1;
            const route = parseRoute(metadata.route);
            routeMap.set(route, (routeMap.get(route) ?? 0) + 1);
          }
          const topRoutes = Array.from(routeMap.entries())
            .map(([route, count]) => ({ route, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
          return { total, c4xx, c409, c5xx, topRoutes };
        };

        const [queueDepth, staleCount, printDepth, printFailedCount, deadLetterCount, latestPaymentAt, perfErrorSummary] = await Promise.all([
          safeCount(
            supabase
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", auth.branchId!)
              .eq("status", "queued")
          ),
          safeCount(
            supabase
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", auth.branchId!)
              .eq("status", "queued")
              .lt("created_at", staleSinceIso)
          ),
          safeCount(
            supabase
              .from("print_jobs")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", auth.branchId!)
              .in("status", ["pending", "printing", "retrying"])
          ),
          safeCount(
            supabase
              .from("print_jobs")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", auth.branchId!)
              .eq("status", "failed")
              .gt("created_at", deadLetterSinceIso)
          ),
          safeCount(
            supabase
              .from("audit_logs")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", auth.branchId!)
              .in("action", ["pos_order_dead_letter", "pos_payment_dead_letter", "pos_print_dead_letter"])
              .gt("created_at", deadLetterSinceIso)
          ),
          safeLatestPayment(),
          safePerfErrorSummary()
        ]);

        let level: "ok" | "warn" | "critical" = "ok";
        if (queueDepth >= POS_GUARDS.orderQueueHardLimit || printDepth >= POS_GUARDS.printQueueHardLimit) {
          level = "critical";
        } else if (perfErrorSummary.c5xx >= 3) {
          level = "critical";
        } else if (staleCount > 0 || deadLetterCount > 0 || printFailedCount > 0 || perfErrorSummary.total > 0) {
          level = "warn";
        }

        return {
          tenant_id: auth.tenantId,
          branch_id: auth.branchId,
          level,
          queued_orders: queueDepth,
          queued_orders_stale: staleCount,
          order_queue_limit: POS_GUARDS.orderQueueHardLimit,
          print_queue_depth: printDepth,
          print_queue_limit: POS_GUARDS.printQueueHardLimit,
          print_failed_recent: printFailedCount,
          dead_letters_recent: deadLetterCount,
          api_errors_recent_total: perfErrorSummary.total,
          api_errors_4xx_recent: perfErrorSummary.c4xx,
          api_errors_409_recent: perfErrorSummary.c409,
          api_errors_5xx_recent: perfErrorSummary.c5xx,
          api_error_routes_top: perfErrorSummary.topRoutes,
          dead_letter_window_minutes: POS_GUARDS.deadLetterWindowMinutes,
          stale_window_minutes: POS_GUARDS.staleQueuedMinutes,
          latest_payment_at: latestPaymentAt,
          server_time: new Date().toISOString()
        };
      }
    });

    const response = ok(payload);
    response.headers.set("x-pos-monitor-cache", cacheSource);
    response.headers.set("x-pos-monitor-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown monitor error";
    const authError =
      message.toLowerCase().includes("authenticated") ||
      message.toLowerCase().includes("tenant/branch") ||
      message.toLowerCase().includes("unauthorized");

    if (authError) {
      const response = fail("unauthorized", message, 401);
      response.headers.set("x-pos-monitor-ms", String(Date.now() - startedAt));
      return response;
    }

    console.warn("[pos-monitor] fail-soft query error", {
      tenantId: fallbackTenantId,
      branchId: fallbackBranchId,
      message
    });

    const response = ok({
      tenant_id: fallbackTenantId,
      branch_id: fallbackBranchId,
      level: "warn" as const,
      queued_orders: 0,
      queued_orders_stale: 0,
      order_queue_limit: POS_GUARDS.orderQueueHardLimit,
      print_queue_depth: 0,
      print_queue_limit: POS_GUARDS.printQueueHardLimit,
      print_failed_recent: 0,
      dead_letters_recent: 0,
      api_errors_recent_total: 0,
      api_errors_4xx_recent: 0,
      api_errors_409_recent: 0,
      api_errors_5xx_recent: 0,
      api_error_routes_top: [],
      dead_letter_window_minutes: POS_GUARDS.deadLetterWindowMinutes,
      stale_window_minutes: POS_GUARDS.staleQueuedMinutes,
      latest_payment_at: null,
      server_time: new Date().toISOString(),
      monitor_degraded: true
    });
    response.headers.set("x-pos-monitor-cache", "degraded");
    response.headers.set("x-pos-monitor-ms", String(Date.now() - startedAt));
    return response;
  }
}

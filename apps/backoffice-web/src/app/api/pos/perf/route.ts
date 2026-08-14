import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type PerfPayload = {
  route?: string;
  from_route?: string | null;
  nav_duration_ms?: number | null;
  ttfb_ms?: number | null;
  status_code?: number | null;
  error_code?: string | null;
  http_method?: string | null;
  resource_name?: string | null;
  source?: string | null;
  captured_at?: string | null;
};

type PerfLogRow = {
  id: string;
  created_at: string;
  action: string;
  metadata: Record<string, unknown> | null;
};

// Onsite safeguard: coalesce only normal telemetry; error telemetry always bypasses sampling.
const PERF_SAMPLE_TTL_MS = 10_000;

function clampMetric(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, Number(parsed.toFixed(2))));
}

function parseRoute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const route = value.trim();
  if (!route || route.length > 200) return null;
  if (!route.startsWith("/")) return null;
  return route;
}

function parseErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!normalized) return null;
  return normalized.slice(0, 80);
}

export async function GET(req: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "monitor:view" });
    const canViewPerf = Boolean(auth.branchRole && ["manager", "owner", "accountant"].includes(auth.branchRole)) || auth.platformRole === "it_admin";
    if (!canViewPerf) {
      return fail("forbidden_role", "Only manager, owner, accountant, or IT Admin can view route performance logs.", 403);
    }

    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(10, Math.min(300, Math.trunc(limitRaw))) : 100;
    const routeFilter = parseRoute(searchParams.get("route"));
    const supabase = getSupabaseServiceClient();

    let query = supabase
      .from("audit_logs")
      .select("id,created_at,action,metadata")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("action", "pos_route_perf")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (routeFilter) {
      query = query.contains("metadata", { route: routeFilter });
    }

    const { data, error } = await query;
    if (error) {
      return fail("perf_logs_query_failed", error.message, 500);
    }

    const rows = (data ?? []) as PerfLogRow[];
    const byRoute = new Map<
      string,
      { count: number; navSum: number; navCount: number; ttfbSum: number; ttfbCount: number; navMax: number; ttfbMax: number }
    >();

    for (const row of rows) {
      const metadata = row.metadata ?? {};
      const route = parseRoute(metadata.route) ?? "unknown";
      const nav = clampMetric(metadata.nav_duration_ms, 0, 120000);
      const ttfb = clampMetric(metadata.ttfb_ms, 0, 120000);
      const current = byRoute.get(route) ?? {
        count: 0,
        navSum: 0,
        navCount: 0,
        ttfbSum: 0,
        ttfbCount: 0,
        navMax: 0,
        ttfbMax: 0
      };

      current.count += 1;
      if (nav !== null) {
        current.navSum += nav;
        current.navCount += 1;
        current.navMax = Math.max(current.navMax, nav);
      }
      if (ttfb !== null) {
        current.ttfbSum += ttfb;
        current.ttfbCount += 1;
        current.ttfbMax = Math.max(current.ttfbMax, ttfb);
      }
      byRoute.set(route, current);
    }

    const summary = Array.from(byRoute.entries())
      .map(([route, stat]) => ({
        route,
        count: stat.count,
        avg_nav_ms: stat.navCount > 0 ? Number((stat.navSum / stat.navCount).toFixed(2)) : null,
        avg_ttfb_ms: stat.ttfbCount > 0 ? Number((stat.ttfbSum / stat.ttfbCount).toFixed(2)) : null,
        max_nav_ms: stat.navCount > 0 ? Number(stat.navMax.toFixed(2)) : null,
        max_ttfb_ms: stat.ttfbCount > 0 ? Number(stat.ttfbMax.toFixed(2)) : null
      }))
      .sort((a, b) => (b.avg_nav_ms ?? 0) - (a.avg_nav_ms ?? 0));

    return ok({
      items: rows,
      summary,
      total: rows.length
    });
  } catch (error) {
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "monitor:view" });
    const body = (await req.json()) as PerfPayload;
    const route = parseRoute(body.route);
    if (!route) {
      return fail("invalid_route", "route is required and must start with '/'.", 422);
    }

    const navDuration = clampMetric(body.nav_duration_ms, 0, 120000);
    const ttfb = clampMetric(body.ttfb_ms, 0, 120000);
    const fromRoute = parseRoute(body.from_route) ?? null;
    const source = typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 40) : "unknown";
    const resourceName = typeof body.resource_name === "string" ? body.resource_name.trim().slice(0, 300) : null;
    const statusCode = clampMetric(body.status_code, 100, 599);
    const errorCode = parseErrorCode(body.error_code);
    const httpMethod = typeof body.http_method === "string" ? body.http_method.trim().toUpperCase().slice(0, 12) : null;
    const capturedAt = typeof body.captured_at === "string" ? body.captured_at : new Date().toISOString();
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const writeAudit = () =>
      appendAuditLog({
        tenantId: auth.tenantId ?? undefined,
        branchId: auth.branchId ?? undefined,
        actorUserId: auth.userId,
        actorRole: auth.branchRole ?? auth.platformRole,
        action: "pos_route_perf",
        targetTable: "pos_routes",
        module: "pos_performance",
        entityType: "route_perf",
        metadata: {
          route,
          from_route: fromRoute,
          nav_duration_ms: navDuration,
          ttfb_ms: ttfb,
          status_code: statusCode,
          error_code: errorCode,
          http_method: httpMethod,
          resource_name: resourceName,
          source,
          captured_at: capturedAt
        },
        userAgent
      });

    const isErrorTelemetry = errorCode !== null || (statusCode !== null && statusCode >= 400);
    let result: Awaited<ReturnType<typeof appendAuditLog>>;
    let sampled = false;

    if (isErrorTelemetry) {
      result = await writeAudit();
    } else {
      const sampleKey = [
        "pos-perf",
        auth.tenantId ?? "unknown-tenant",
        auth.branchId ?? "unknown-branch",
        auth.userId ?? "unknown-user",
        route,
        source
      ].join(":");
      const cached = await readThroughRuntimeCache({
        key: sampleKey,
        ttlMs: PERF_SAMPLE_TTL_MS,
        loader: writeAudit
      });
      result = cached.value;
      sampled = cached.source !== "miss";
    }

    if (sampled) {
      return ok({ ok: true, logged: false, sampled: true }, 202);
    }

    if (!result.inserted) {
      console.error("[pos-perf] audit log insert skipped", {
        tenantId: auth.tenantId ?? null,
        branchId: auth.branchId ?? null,
        userId: auth.userId,
        route,
        error: result.error ?? "audit_log_write_failed"
      });
      return ok({ ok: true, logged: false }, 202);
    }

    return ok({ ok: true, logged: true }, 201);
  } catch (error) {
    console.error("[pos-perf] non-blocking failure", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return ok({ ok: true, logged: false }, 202);
  }
}

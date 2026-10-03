import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("POS monitor load shedding", () => {
  const monitor = src("src/app/api/pos/monitor/route.ts");
  const resilience = src("src/lib/pos-resilience.ts");
  const migration = src("../../supabase/migrations/20261003114212_pos_monitor_hotpath_indexes.sql");

  it("keeps monitor DB fanout behind a one-minute runtime cache with stale fallback", () => {
    expect(monitor).toContain("ttlMs: 60_000");
    expect(monitor).toContain("staleIfErrorMs: 3 * 60_000");
    expect(monitor).toContain("loaderTimeoutMs: 4_000");
    expect(monitor).toContain('timeoutCode: "pos_monitor_loader_timeout"');
    expect(monitor).toContain("safeQueuedOrderSummary");
    expect(monitor).toContain("safeAuditSummary");
    expect(monitor).toContain('Cache-Control", "private, max-age=30, stale-while-revalidate=60"');
  });

  it("does not split queued and audit monitor summaries into duplicate reads", () => {
    expect(monitor).toContain('.select("created_at", { count: "exact" })');
    expect(monitor).toContain('.select("action,metadata")');
    expect(monitor).toContain('.in("action", [...deadLetterActions, "pos_route_perf"])');
    expect(monitor).not.toContain("safePerfErrorSummary");
  });

  it("keeps the default monitor poll at no faster than one minute", () => {
    expect(resilience).toContain('NEXT_PUBLIC_POS_MONITOR_POLL_MS", 60000, 30000, 120000');
    expect(resilience).not.toContain('NEXT_PUBLIC_POS_MONITOR_POLL_MS", 30000, 15000, 120000');
  });

  it("adds composite indexes for the remaining monitor hot paths", () => {
    expect(migration).toContain("idx_audit_logs_scope_action_created");
    expect(migration).toContain("tenant_id, branch_id, action, created_at desc");
    expect(migration).toContain("idx_orders_scope_status_updated");
    expect(migration).toContain("tenant_id, branch_id, status, updated_at desc");
  });
});

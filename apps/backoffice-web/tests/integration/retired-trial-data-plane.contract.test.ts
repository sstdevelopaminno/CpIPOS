import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fromRoot = (path: string) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

describe("retired CpiPOS-002 fail-closed data-plane policy", () => {
  const serverRouter = fromRoot("src/lib/server/tenant-data-router.ts");
  const routedClient = fromRoot("src/lib/tenant-data-router.ts");
  const printerRouter = fromRoot("src/lib/printing/print-execution-data-plane.ts");

  it("never constructs a secondary Supabase service client from obsolete credentials", () => {
    expect(serverRouter).not.toContain("createClient(");
    expect(serverRouter).toContain("export function isTrialDataRoutingConfigured() {\n  return false;");
    expect(serverRouter).toContain('if (route.dataHome === "trial") {');
    expect(serverRouter).toContain('throw new Error("trial_data_route_unavailable")');
  });

  it("hard-disables the legacy dynamic router even if obsolete environment flags remain", () => {
    expect(routedClient).toContain("function trialRoutingEnabled() {\n  // Hard-disabled even when stale TRIAL_DATA_ROUTING_ENABLED is set.\n  return false;");
    expect(routedClient).toContain('"trial_data_plane_retired"');
    expect(routedClient).not.toContain('process.env.TRIAL_SUPABASE_SERVICE_ROLE_KEY');
  });

  it("never dispatches print jobs to the retired Trial data plane", () => {
    expect(printerRouter).toContain("function trialRoutingEnabled() {\n  // CpiPOS-002 is retired; printer jobs must never reach its former database.\n  return false;");
    expect(printerRouter).toContain('if (home === "primary") return');
    expect(printerRouter).toContain('throw new Error("trial_data_routing_disabled")');
  });

  it("retains guarded Primary-only behavior without silently changing tenant data_home", () => {
    expect(serverRouter).toContain('if (route.dataHome === "primary") {');
    expect(routedClient).toContain("getPrimarySupabaseServiceClient");
    expect(serverRouter).not.toContain(".update({ data_home:");
  });
});

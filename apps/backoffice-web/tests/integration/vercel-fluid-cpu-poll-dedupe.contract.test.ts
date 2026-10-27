import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function src(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Hobby Fluid CPU: POS request deduplication without feature reductions", () => {
  const lifecycle = src("src/components/pos-preview/pos-subscription-lifecycle-guard.tsx");
  const billing = src("src/app/api/pos/billing/runtime/route.ts");
  const printer = src("src/components/printing/browser-print-agent.tsx");

  it("coalesces redundant focus/visibility requests but does not mute real billing events", () => {
    expect(lifecycle).toContain("const PASSIVE_REFRESH_MIN_GAP_MS=15_000;");
    expect(lifecycle).toContain('const passive=source==="focus" || source==="fallback";');
    expect(lifecycle).toContain('if(passive && document.visibilityState==="hidden")return;');
    expect(lifecycle).toContain("Date.now()-lastRuntimeRefreshAt.current<PASSIVE_REFRESH_MIN_GAP_MS");
    expect(lifecycle).toContain("if(refreshInFlight.current)return;");
    expect(lifecycle).toContain("lastRuntimeRefreshAt.current=Date.now();");
    expect(lifecycle).toContain('onOnline=()=>void refreshRuntime("online")');
    expect(lifecycle).toContain('refreshRuntime("realtime")');
    expect(lifecycle).toContain('refreshRuntime("push")');
    expect(lifecycle).toContain('refreshRuntime("fallback"),5*60_000');
    expect(lifecycle).toContain("}catch{");
  });

  it("preserves immediate server freshness for realtime/push/online and existing clients", () => {
    expect(billing).toContain("const reason=new URL(request.url).searchParams.get");
    expect(billing).toContain('const forceFresh=reason!=="focus" && reason!=="fallback";');
    expect(billing).toContain("loadPosSubscriptionLifecycleGuard(scope.session.tenant_id,{forceFresh})");
    expect(billing).toContain('response.headers.set("cache-control","private, no-store")');
    expect(billing).toContain("await requirePosSessionForNonSaleRecovery()");
    expect(billing).not.toContain("await requirePosSession()");
  });

  it("prevents concurrent print claims on focus while preserving fast and idle polling", () => {
    expect(printer).toContain("let tickInFlight = false;");
    expect(printer).toContain("if (!active || tickInFlight) return;");
    expect(printer).toContain("tickInFlight = true;");
    expect(printer).toContain("tickInFlight = false;");
    expect(printer).toContain("const POLL_MS = 4000;");
    expect(printer).toContain("const IDLE_POLL_MS = 10000;");
    expect(printer).toContain("const DEEP_IDLE_POLL_MS = 20000;");
    expect(printer).toContain("const HIDDEN_POLL_MS = 30000;");
    expect(printer).toContain('postAgentApi<ClaimResponse>("/api/print-agent/v1/jobs/claim"');
    expect(printer).toContain("agentAttemptIdForJob(job)");
    expect(printer).toContain("rememberPrinted(job.id)");
  });
});

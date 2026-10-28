import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("print agent subscription lifecycle gate", () => {
  it("blocks job claim when the tenant subscription is locked", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/print-agent/v1/jobs/claim/route.ts"),
      "utf8"
    );
    expect(source).toContain("loadPosSubscriptionLifecycleGuard(agent.tenant_id)");
    expect(source).toContain("subscription_runtime_unavailable");
    expect(source).toContain("subscription_access_locked");
    expect(source).toContain("subscription.locked && !subscription.exempt");

    const authIndex = source.indexOf("requirePrintAgent(req");
    const gateIndex = source.indexOf("loadPosSubscriptionLifecycleGuard(agent.tenant_id)");
    const claimIndex = source.indexOf("claimPrintJobsStabilized(agent");
    expect(authIndex).toBeGreaterThan(0);
    expect(gateIndex).toBeGreaterThan(authIndex);
    expect(claimIndex).toBeGreaterThan(gateIndex);
  });
});

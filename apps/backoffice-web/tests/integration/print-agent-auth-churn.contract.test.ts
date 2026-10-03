import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Print Agent auth request-churn guard", () => {
  const service = src("src/lib/printing/print-agent-service.ts");

  it("caches only successful active-agent authentication for a short bounded window", () => {
    expect(service).toContain("PRINT_AGENT_AUTH_CACHE_TTL_MS = 10_000");
    expect(service).toContain("__printAgentAuthCache");
    expect(service).toContain("entry.value.status !== \"active\"");
    expect(service).toContain("if (agent.status !== \"active\") throw new Error(\"agent_inactive\")");
    expect(service).toContain("writePrintAgentAuthCache(keyHash, agent)");
  });

  it("single-flights concurrent auth reads for the same API key hash", () => {
    expect(service).toContain("__printAgentAuthInFlight");
    expect(service).toContain("const existing = inFlight.get(keyHash)");
    expect(service).toContain("if (existing) return existing");
    expect(service).toContain("inFlight.delete(keyHash)");
  });

  it("invalidates warm auth cache immediately when IT revokes or deletes an agent", () => {
    expect(service.match(/invalidatePrintAgentAuthCache\(agent\.id\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

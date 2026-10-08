import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessProductionReadiness } from "../check-production-readiness.mjs";

const primary = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-publishable",
  SUPABASE_SERVICE_ROLE_KEY: "test-secret",
  POS_SESSION_HANDOFF_SECRET: "test-secret",
  TABLE_QR_SIGNING_SECRET: "test-secret"
};

describe("production configuration presence-only preflight", () => {
  it("accepts the explicitly chosen memory backend without Redis but reports cross-instance limitations", () => {
    for (const env of [primary, { ...primary, RATE_LIMIT_BACKEND: "memory" }]) {
      const report = assessProductionReadiness(env);
      assert.equal(report.ok, true);
      assert.equal(report.status, "ready_with_warnings");
      assert.equal(report.rateLimitBackend, "memory");
      assert.equal(report.rateLimitSharedBackendConfigured, false);
      assert.deepEqual(report.missingEnvironmentNames, []);
      assert.ok(report.warnings.some(x => x.includes("per-process")));
      assert.ok(report.warnings.some(x => x.includes("WAF")));
    }
  });

  it("rejects memory mode only when this release explicitly requires distributed throttling", () => {
    const report = assessProductionReadiness(primary, { distributedRateLimitRequired: true });
    assert.equal(report.ok, false);
    assert.equal(report.status, "blocked");
    assert.ok(report.blockedCapabilities.some(x => x.includes("Distributed")));
  });

  it("requires both REST credentials when upstash is selected", () => {
    const report = assessProductionReadiness({ ...primary, RATE_LIMIT_BACKEND: "upstash" });
    assert.equal(report.ok, false);
    assert.ok(report.missingEnvironmentNames.includes("UPSTASH_REDIS_REST_URL"));
    assert.ok(report.missingEnvironmentNames.includes("UPSTASH_REDIS_REST_TOKEN"));
    assert.equal(report.rateLimitSharedBackendConfigured, false);
  });

  it("rejects unsupported redis TCP or arbitrary backend values", () => {
    for (const mode of ["redis", "invalid"]) {
      const report = assessProductionReadiness({ ...primary, RATE_LIMIT_BACKEND: mode });
      assert.equal(report.ok, false);
      assert.ok(report.blockedCapabilities.some(x => x.includes("must be memory or upstash")));
    }
  });

  it("accepts Upstash credential presence while requiring independent connectivity testing", () => {
    const report = assessProductionReadiness({
      ...primary, RATE_LIMIT_BACKEND: "upstash",
      UPSTASH_REDIS_REST_URL: "https://example.invalid",
      UPSTASH_REDIS_REST_TOKEN: "private-test-token"
    }, { distributedRateLimitRequired: true });
    assert.equal(report.ok, true);
    assert.equal(report.rateLimitSharedBackendConfigured, true);
    assert.ok(report.warnings.some(x => x.includes("not connectivity")));
    assert.equal(JSON.stringify(report).includes("private-test-token"), false);
  });

  it("allows disabled Trial by default and still rejects Trial without credentials when enabled or required", () => {
    assert.equal(assessProductionReadiness({ ...primary, TRIAL_DATA_ROUTING_ENABLED: "false" }).ok, true);
    const enabled = assessProductionReadiness({ ...primary, TRIAL_DATA_ROUTING_ENABLED: "true" });
    assert.equal(enabled.ok, false);
    assert.ok(enabled.missingEnvironmentNames.includes("TRIAL_SUPABASE_SERVICE_ROLE_KEY"));
    assert.equal(assessProductionReadiness(primary, {trialRequired:true}).ok, false);
  });

  it("passes presence-only checks for configured Trial and never prints sensitive values", () => {
    const report = assessProductionReadiness({
      ...primary,
      TRIAL_DATA_ROUTING_ENABLED: "true",
      TRIAL_SUPABASE_URL: "https://example.invalid",
      TRIAL_SUPABASE_SERVICE_ROLE_KEY: "secret-trial-token"
    }, { trialRequired: true });
    assert.equal(report.ok, true);
    assert.equal(report.trialRoutingConfigured, true);
    assert.equal(JSON.stringify(report).includes("secret-trial-token"), false);
  });

  it("blocks missing core Primary credentials independent of memory/Upstash choice", () => {
    const report = assessProductionReadiness({ RATE_LIMIT_BACKEND: "memory" });
    assert.equal(report.ok, false);
    assert.ok(report.missingEnvironmentNames.includes("SUPABASE_SERVICE_ROLE_KEY"));
    assert.ok(report.missingEnvironmentNames.includes("TABLE_QR_SIGNING_SECRET"));
  });
});

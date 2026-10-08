import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessProductionReadiness } from "../check-production-readiness.mjs";

const required = {
  NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "example",
  SUPABASE_SERVICE_ROLE_KEY: "secret",
  POS_SESSION_HANDOFF_SECRET: "secret",
  TABLE_QR_SIGNING_SECRET: "secret",
  RATE_LIMIT_BACKEND: "upstash",
  UPSTASH_REDIS_REST_URL: "https://placeholder.invalid",
  UPSTASH_REDIS_REST_TOKEN: "secret"
};

describe("production configuration presence-only preflight", () => {
  it("requires distributed rate limiting rather than process memory", () => {
    const { RATE_LIMIT_BACKEND, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ...env } = required;
    const report = assessProductionReadiness(env);
    assert.equal(report.ok, false);
    assert.ok(report.blockedCapabilities.some(x => x.includes("RATE_LIMIT_BACKEND")));
    assert.ok(report.missingEnvironmentNames.includes("UPSTASH_REDIS_REST_TOKEN"));
  });

  it("allows Trial disabled when not explicitly included in release scope", () => {
    assert.equal(assessProductionReadiness(required).ok, true);
  });

  it("blocks missing Trial credentials if Trial is enabled or required", () => {
    const report = assessProductionReadiness({ ...required, TRIAL_DATA_ROUTING_ENABLED: "true" });
    assert.equal(report.ok, false);
    assert.ok(report.missingEnvironmentNames.includes("TRIAL_SUPABASE_SERVICE_ROLE_KEY"));
    assert.equal(assessProductionReadiness(required, {trialRequired:true}).ok, false);
  });

  it("passes presence test for eligible fully-configured production environment without emitting values", () => {
    const report = assessProductionReadiness({
      ...required,
      TRIAL_DATA_ROUTING_ENABLED: "true",
      TRIAL_SUPABASE_URL: "https://placeholder.invalid",
      TRIAL_SUPABASE_SERVICE_ROLE_KEY: "sensitive-test-placeholder"
    }, {trialRequired:true});
    assert.equal(report.ok, true);
    assert.equal(JSON.stringify(report).includes("sensitive-test-placeholder"), false);
  });
});

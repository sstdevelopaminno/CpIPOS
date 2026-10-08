/**
 * Read-only CpIPOS production configuration preflight.
 * Checks presence and configuration intent, not credential validity or live WAF.
 * Never prints secret values, connects to services, or performs writes.
 *
 * Default: memory-based login limiting is a permitted, explicitly degraded
 * operating mode. Edge/WAF mitigation and multi-instance testing remain
 * separately documented release evidence, not a simulated passing gate.
 *
 * node scripts/check-production-readiness.mjs
 * node scripts/check-production-readiness.mjs --distributed-rate-limit-required
 * node scripts/check-production-readiness.mjs --trial-required
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

function hasValue(env, name) {
  return typeof env[name] === "string" && env[name].trim().length > 0;
}

export function assessProductionReadiness(env, { trialRequired = false, distributedRateLimitRequired = false } = {}) {
  const missing = [];
  const blocked = [];
  const warnings = [];

  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "POS_SESSION_HANDOFF_SECRET",
    "TABLE_QR_SIGNING_SECRET"
  ]) {
    if (!hasValue(env, name)) missing.push(name);
  }

  const configuredBackend = String(env.RATE_LIMIT_BACKEND ?? "").trim().toLowerCase();
  const backend = configuredBackend || "memory";
  if (backend === "memory") {
    warnings.push(
      "Login rate limiting uses per-process memory only. Limits are not shared across Vercel instances. Configure and verify an independent edge/WAF guard before broad multi-store rollout."
    );
    if (distributedRateLimitRequired) {
      blocked.push("Distributed login throttling was explicitly required, but RATE_LIMIT_BACKEND is memory.");
    }
  } else if (backend === "upstash") {
    if (!hasValue(env, "UPSTASH_REDIS_REST_URL")) missing.push("UPSTASH_REDIS_REST_URL");
    if (!hasValue(env, "UPSTASH_REDIS_REST_TOKEN")) missing.push("UPSTASH_REDIS_REST_TOKEN");
    warnings.push("Upstash key presence is not connectivity or fail-closed outage-test evidence.");
  } else {
    blocked.push("RATE_LIMIT_BACKEND must be memory or upstash (redis TCP is not implemented).");
  }

  const trialConfigured = /^(true|1)$/i.test(String(env.TRIAL_DATA_ROUTING_ENABLED ?? ""));
  if (trialConfigured || trialRequired) {
    if (!trialConfigured) blocked.push("TRIAL_DATA_ROUTING_ENABLED must be true for Trial acceptance.");
    if (!hasValue(env, "TRIAL_SUPABASE_URL")) missing.push("TRIAL_SUPABASE_URL");
    if (!hasValue(env, "TRIAL_SUPABASE_SERVICE_ROLE_KEY")) missing.push("TRIAL_SUPABASE_SERVICE_ROLE_KEY");
  }

  const ok = missing.length === 0 && blocked.length === 0;
  return {
    ok,
    status: ok ? (warnings.length ? "ready_with_warnings" : "ready") : "blocked",
    missingEnvironmentNames: missing,
    blockedCapabilities: blocked,
    warnings,
    rateLimitBackend: backend,
    rateLimitSharedAcrossInstances: backend === "upstash" && !missing.includes("UPSTASH_REDIS_REST_URL") && !missing.includes("UPSTASH_REDIS_REST_TOKEN"),
    trialRoutingConfigured: trialConfigured,
    evaluated: "presence-only; provider credentials, WAF enforcement, external reachability and device acceptance were NOT verified"
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const allowed = new Set(["--trial-required", "--distributed-rate-limit-required"]);
  if (args.some(arg => !allowed.has(arg))) {
    console.error("Usage: node scripts/check-production-readiness.mjs [--trial-required] [--distributed-rate-limit-required]");
    process.exitCode = 1;
  } else {
    const report = assessProductionReadiness(process.env, {
      trialRequired: args.includes("--trial-required"),
      distributedRateLimitRequired: args.includes("--distributed-rate-limit-required")
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      console.error("BLOCKED: complete the listed mandatory configuration before this release.");
      process.exitCode = 2;
    } else if (report.warnings.length) {
      console.warn("WARNING: configuration preflight passed in a reduced-security mode; review warnings and independent WAF evidence.");
    }
  }
}

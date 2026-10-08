/**
 * Non-destructive CpIPOS Production configuration preflight.
 * Evaluates environment names only. It NEVER prints secret values, connects
 * to a database, applies migrations or changes Production.
 *
 * Run in a trusted protected environment:
 *   node scripts/check-production-readiness.mjs
 *   node scripts/check-production-readiness.mjs --trial-required
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

function hasValue(env, name) {
  return typeof env[name] === "string" && env[name].trim().length > 0;
}

export function assessProductionReadiness(env, { trialRequired = false } = {}) {
  const missing = [];
  const disabled = [];
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "POS_SESSION_HANDOFF_SECRET",
    "TABLE_QR_SIGNING_SECRET"
  ]) {
    if (!hasValue(env, name)) missing.push(name);
  }

  const selectedBackend = String(env.RATE_LIMIT_BACKEND ?? "").trim().toLowerCase();
  if (selectedBackend !== "upstash") {
    disabled.push("RATE_LIMIT_BACKEND must be upstash for cross-instance login throttling");
  }
  if (!hasValue(env, "UPSTASH_REDIS_REST_URL")) missing.push("UPSTASH_REDIS_REST_URL");
  if (!hasValue(env, "UPSTASH_REDIS_REST_TOKEN")) missing.push("UPSTASH_REDIS_REST_TOKEN");

  const trialConfigured = /^(true|1)$/i.test(String(env.TRIAL_DATA_ROUTING_ENABLED ?? ""));
  if (trialConfigured || trialRequired) {
    if (!trialConfigured) disabled.push("TRIAL_DATA_ROUTING_ENABLED must be true for Trial acceptance");
    if (!hasValue(env, "TRIAL_SUPABASE_URL")) missing.push("TRIAL_SUPABASE_URL");
    if (!hasValue(env, "TRIAL_SUPABASE_SERVICE_ROLE_KEY")) missing.push("TRIAL_SUPABASE_SERVICE_ROLE_KEY");
  }

  return {
    ok: missing.length === 0 && disabled.length === 0,
    missingEnvironmentNames: missing,
    blockedCapabilities: disabled,
    trialRoutingConfigured: trialConfigured,
    evaluated: "presence-only; values, credentials and network access are never emitted"
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const validArgs = process.argv.slice(2).every(arg => arg === "--trial-required");
  if (!validArgs) {
    console.error("Usage: node scripts/check-production-readiness.mjs [--trial-required]");
    process.exitCode = 1;
  } else {
    const report = assessProductionReadiness(process.env, {
      trialRequired: process.argv.includes("--trial-required")
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      console.error("BLOCKED: complete provider-side configuration and safe validation before release.");
      process.exitCode = 2;
    }
  }
}

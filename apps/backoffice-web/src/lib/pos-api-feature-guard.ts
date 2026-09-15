import "server-only";

import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail } from "@/lib/http";

type FeatureScope = {
  tenantId?: string | null;
  branchId?: string | null;
};

// The feature-gate layer caches resolved decisions, but several POS APIs can reach a
// cold/expired cache concurrently. Share the in-progress check for an identical scope
// so only one set of subscription/override queries reaches Supabase at a time.
const posFeatureCheckInFlight = new Map<string, Promise<void>>();

export async function requirePosApiFeature(scope: FeatureScope, feature: string) {
  const tenantId = String(scope.tenantId ?? "").trim();
  const branchId = String(scope.branchId ?? "").trim();
  const featureKey = String(feature ?? "").trim();

  // Preserve existing validation/error semantics when a key cannot be safely formed.
  if (!tenantId || !featureKey) {
    await requireTenantFeature(tenantId, featureKey, branchId || null);
    return;
  }

  const cacheKey = `${tenantId}:${branchId || "tenant"}:${featureKey}`;
  const existing = posFeatureCheckInFlight.get(cacheKey);
  if (existing) {
    await existing;
    return;
  }

  const pending = requireTenantFeature(tenantId, featureKey, branchId || null).then(() => undefined);
  posFeatureCheckInFlight.set(cacheKey, pending);
  try {
    await pending;
  } finally {
    if (posFeatureCheckInFlight.get(cacheKey) === pending) {
      posFeatureCheckInFlight.delete(cacheKey);
    }
  }
}

export function featureGateFail(error: unknown): Response | null {
  // getAuthContext intentionally throws a plain Error when there is no authenticated
  // Supabase/POS session. Feature-gated routes call auth before the feature check, so
  // normalize that expected condition to 401 instead of leaking it as a generic 500.
  if (error instanceof Error && error.message === "User is not authenticated.") {
    return fail("unauthorized", "User is not authenticated.", 401);
  }

  if (!(error instanceof FeatureGateError)) return null;
  if (error.code === "feature_not_enabled") {
    return Response.json(
      {
        ok: false,
        error: "feature_not_enabled",
        feature: error.message.match(/'([^']+)'/)?.[1] ?? null
      },
      { status: 403 }
    );
  }
  return fail(error.code, error.message, error.status);
}

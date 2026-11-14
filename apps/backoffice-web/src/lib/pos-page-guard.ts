import "server-only";

import { notFound, redirect } from "next/navigation";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { featureForPosPermission } from "@/lib/pos-feature-map";
import { PosGuardError, requirePermission, requirePosSession, type PosPermission, type PosSessionScope } from "@/lib/pos-session-guard";

export async function requirePosPagePermission(permission: PosPermission, fallbackPath = "/preview/pos"): Promise<PosSessionScope> {
  try {
    const scope = await requirePosSession();
    if (String(scope.session.role ?? "").trim().toLowerCase() === "kitchen") {
      redirect("/preview/pos/kitchen");
    }
    requirePermission(scope, permission);
    const feature = featureForPosPermission(permission);
    if (feature) {
      await requireTenantFeature(scope.session.tenant_id, feature, scope.session.branch_id);
    }
    return scope;
  } catch (error) {
    // Next.js redirects/notFound are control-flow exceptions; preserve them.
    if (error && typeof error === "object" && "digest" in error) throw error;

    // A genuinely expired/invalid POS session needs a deliberate login.
    // The recovery marker prevents login's auto-forward from creating a loop.
    if (error instanceof PosGuardError && error.status === 401) {
      const loginPath = fallbackPath.startsWith("/login/") ? fallbackPath : "/login/store";
      redirect(`${loginPath}${loginPath.includes("?") ? "&" : "?"}from=pos-session`);
    }

    // Unauthorized roles and disabled features must NOT be sent to a login
    // screen that immediately recognizes the same valid POS session again.
    if (error instanceof FeatureGateError && error.code === "feature_not_enabled") notFound();
    if (error instanceof PosGuardError && (error.status === 403 || error.status === 409)) notFound();

    // Transient DB/feature lookups stay on a stable error boundary with a
    // manual retry; they are not evidence the customer's session expired.
    throw error;
  }
}

import { fail, ok } from "@/lib/api/response";
import { readMobileSession } from "@/lib/auth/session";
import { mobileRolePermissions, roleCan } from "@/lib/permissions/mobile-features";
import { mobileMenuItems, mobileSecondaryMenuItems } from "@/lib/permissions/mobile-menu";
import { createServiceClient } from "@/lib/supabase/server";
import type { PosFeatureCode } from "@/types/contracts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function resolveEnabledFeatures(tenantId: string, branchId: string, features: PosFeatureCode[]) {
  const supabase = createServiceClient();
  const featureSet = new Set(features);
  const enabled = Object.fromEntries(Array.from(featureSet).map((feature) => [feature, false])) as Record<PosFeatureCode, boolean>;

  const { data: contract } = await supabase
    .from("tenant_subscription_contracts")
    .select("package_id,status,ended_at,created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ package_id: string | null; status: string | null; ended_at: string | null; created_at: string | null }>();

  const contractActive = contract && (contract.status === "active" || contract.status === "trial") && (!contract.ended_at || new Date(contract.ended_at).getTime() > Date.now());
  if (contractActive && contract.package_id) {
    const { data: packageFeatures } = await supabase
      .from("subscription_package_features")
      .select("feature_code,included")
      .eq("package_id", contract.package_id)
      .in("feature_code", Array.from(featureSet));
    for (const row of packageFeatures ?? []) {
      enabled[row.feature_code as PosFeatureCode] = Boolean(row.included);
    }
  }

  const [{ data: tenantOverrides }, { data: branchOverrides }] = await Promise.all([
    supabase
      .from("tenant_feature_subscriptions")
      .select("feature_code,is_enabled")
      .eq("tenant_id", tenantId)
      .is("branch_id", null)
      .in("feature_code", Array.from(featureSet)),
    supabase
      .from("tenant_feature_subscriptions")
      .select("feature_code,is_enabled")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .in("feature_code", Array.from(featureSet)),
  ]);

  for (const row of tenantOverrides ?? []) enabled[row.feature_code as PosFeatureCode] = Boolean(row.is_enabled);
  for (const row of branchOverrides ?? []) enabled[row.feature_code as PosFeatureCode] = Boolean(row.is_enabled);
  enabled.core_pos_sales = true;
  return enabled;
}

export async function GET() {
  try {
    const scope = await readMobileSession();
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    const allMenuItems = [...mobileMenuItems, ...mobileSecondaryMenuItems];
    const features = allMenuItems.map((item) => item.feature);
    const enabledFeatures = await resolveEnabledFeatures(scope.tenantId, scope.branchId, features);
    const menu = allMenuItems.map((item) => ({
      href: item.href,
      label: item.label,
      permission: item.permission,
      feature: item.feature,
      allowedByRole: roleCan(scope.role, item.permission),
      enabledByPackage: enabledFeatures[item.feature] ?? false,
    }));

    return ok({
      role: scope.role,
      permissions: mobileRolePermissions[scope.role],
      enabledFeatures,
      menu,
    });
  } catch (error) {
    console.error("[mobile.features]", error);
    return fail("features_failed", "โหลดสิทธิ์และฟีเจอร์ไม่สำเร็จ", 503);
  }
}

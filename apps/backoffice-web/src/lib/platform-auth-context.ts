import "server-only";

import type { PlatformRole } from "@pos/shared-types";
import { headers } from "next/headers";
import type { AuthContext } from "@/lib/auth-context";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const platformRoles: PlatformRole[] = ["it_admin", "it_support", "tenant_user"];

function parsePlatformRole(value: unknown): PlatformRole | null {
  if (typeof value !== "string") return null;
  return platformRoles.includes(value as PlatformRole) ? (value as PlatformRole) : null;
}

/**
 * Platform/Control Plane authentication is intentionally independent from POS
 * session cookies. A stale POS session must never be interpreted as an IT
 * operator session, and IT routes must never require tenant/branch POS scope.
 */
export async function getPlatformAuthContext(): Promise<AuthContext> {
  const headerStore = await headers();
  const authHeader = headerStore.get("authorization") ?? headerStore.get("Authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  const supabase = await getSupabaseServerClient();
  const { data, error } = bearerToken ? await supabase.auth.getUser(bearerToken) : await supabase.auth.getUser();

  if (error || !data.user) {
    throw new Error("User is not authenticated.");
  }

  const service = getSupabaseServiceClient();
  const { data: profile, error: profileError } = await service
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", data.user.id)
    .maybeSingle<{ platform_role: PlatformRole | null; is_active: boolean | null }>();

  if (profileError) {
    throw new Error(`Platform profile lookup failed: ${profileError.message}`);
  }
  if (!profile || profile.is_active === false) {
    throw new Error("Platform account is inactive.");
  }

  const role = parsePlatformRole(profile.platform_role ?? data.user.app_metadata?.platform_role) ?? "tenant_user";
  return {
    userId: data.user.id,
    platformRole: role,
    tenantId: null,
    branchId: null,
    branchRole: null
  };
}

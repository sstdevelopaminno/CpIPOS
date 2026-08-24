import "server-only";
import { redirect } from "next/navigation";
import { getServerAuthClient, getServiceClient } from "@/lib/supabase";

export type PlatformRole = "it_admin" | "it_support";
export type Operator = { userId: string; role: PlatformRole };

export async function getOperator(): Promise<Operator | null> {
  const auth = await getServerAuthClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return null;

  const service = getServiceClient();
  const { data: profile, error: profileError } = await service
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", data.user.id)
    .maybeSingle<{ platform_role: string | null; is_active: boolean | null }>();

  if (profileError || !profile || profile.is_active === false) return null;
  if (profile.platform_role !== "it_admin" && profile.platform_role !== "it_support") return null;
  return { userId: data.user.id, role: profile.platform_role };
}

export async function requireOperator(): Promise<Operator> {
  const operator = await getOperator();
  if (!operator) redirect("/it-admin-login");
  return operator;
}

export async function requireAdmin(): Promise<Operator> {
  const operator = await requireOperator();
  if (operator.role !== "it_admin") throw new Error("IT Admin role required.");
  return operator;
}

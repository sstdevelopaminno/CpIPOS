import "server-only";
import { redirect } from "next/navigation";
import { readItSession } from "@/lib/it-session";
import { getServiceClient } from "@/lib/supabase";

export type PlatformRole = "it_admin" | "it_support";
export type Operator = { userId: string; role: PlatformRole };

async function verifyProfile(userId: string, expectedRole?: PlatformRole): Promise<Operator | null> {
  const service = getServiceClient();
  const { data: profile, error } = await service
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", userId)
    .maybeSingle<{ platform_role: string | null; is_active: boolean | null }>();

  if (error || !profile || profile.is_active === false) return null;
  if (profile.platform_role !== "it_admin" && profile.platform_role !== "it_support") return null;
  if (expectedRole && profile.platform_role !== expectedRole) return null;
  return { userId, role: profile.platform_role };
}

export async function getOperator(): Promise<Operator | null> {
  const codeSession = await readItSession();
  if (!codeSession) return null;
  return verifyProfile(codeSession.userId, codeSession.role);
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

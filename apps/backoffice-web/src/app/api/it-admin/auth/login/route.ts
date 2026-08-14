import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || email.length > 254 || password.length > 512) {
    return fail("invalid_credentials", "Email and password are required.", 422);
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return fail("invalid_credentials", "Email or password is incorrect.", 401);
  }

  const service = getSupabaseServiceClient();
  const { data: profile, error: profileError } = await service
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", data.user.id)
    .maybeSingle<{ platform_role: string | null; is_active: boolean | null }>();

  const role = String(profile?.platform_role ?? "");
  if (profileError || profile?.is_active === false || (role !== "it_admin" && role !== "it_support")) {
    await supabase.auth.signOut();
    return fail("platform_access_denied", "This account is not authorized for the Control Plane.", 403);
  }

  const response = ok({ platform_role: role, redirect_to: "/it-admin" });
  response.headers.set("cache-control", "no-store");
  return response;
}

import { NextResponse } from "next/server";
import { getServerAuthClient, getServiceClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || email.length > 254 || password.length > 512) {
    return NextResponse.json({ error: { code: "invalid_credentials", message: "Email and password are required." } }, { status: 422 });
  }

  const auth = await getServerAuthClient();
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return NextResponse.json({ error: { code: "invalid_credentials", message: "Email or password is incorrect." } }, { status: 401 });
  }

  const service = getServiceClient();
  const { data: profile, error: profileError } = await service
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", data.user.id)
    .maybeSingle<{ platform_role: string | null; is_active: boolean | null }>();

  if (profileError || !profile || profile.is_active === false || (profile.platform_role !== "it_admin" && profile.platform_role !== "it_support")) {
    await auth.auth.signOut();
    return NextResponse.json({ error: { code: "platform_access_denied", message: "This account is not authorized for the IT Control Plane." } }, { status: 403 });
  }

  return NextResponse.json({ data: { redirect_to: "/it-admin", platform_role: profile.platform_role } }, { headers: { "cache-control": "no-store" } });
}

import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { createItSessionValue, IT_SESSION_COOKIE, itSessionCookieOptions } from "@/lib/it-session";
import { getServiceClient } from "@/lib/supabase";

type ItProfile = {
  id: string;
  platform_role: "it_admin" | "it_support";
  is_active: boolean;
  pin_hash: string | null;
};

function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{4,12}$/.test(code)) {
    return NextResponse.json({ error: { code: "invalid_credentials", message: "กรุณากรอกรหัส IT ให้ถูกต้อง" } }, { status: 422 });
  }

  const service = getServiceClient();
  const ip = requestIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
  const since = new Date(Date.now() - 15 * 60_000).toISOString();

  const { count: recentFailures } = await service
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("login_method", "it_code")
    .eq("success", false)
    .eq("ip_address", ip)
    .gte("created_at", since);

  if ((recentFailures ?? 0) >= 8) {
    return NextResponse.json({ error: { code: "too_many_attempts", message: "ลองรหัสผิดหลายครั้ง กรุณารอประมาณ 15 นาทีแล้วลองใหม่" } }, { status: 429 });
  }

  const { data, error } = await service
    .from("users_profiles")
    .select("id,platform_role,is_active,pin_hash")
    .in("platform_role", ["it_admin", "it_support"])
    .eq("is_active", true)
    .not("pin_hash", "is", null)
    .limit(20);

  if (error) {
    return NextResponse.json({ error: { code: "auth_unavailable", message: "ระบบยืนยันตัวตนไม่พร้อมใช้งาน" } }, { status: 503 });
  }

  let matched: ItProfile | null = null;
  for (const row of (data ?? []) as ItProfile[]) {
    if (!row.pin_hash) continue;
    if (await compare(code, row.pin_hash)) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    await service.from("login_attempts").insert({
      login_method: "it_code",
      success: false,
      failure_reason: "invalid_code",
      ip_address: ip,
      user_agent: userAgent,
      metadata: { surface: "it-admin-web" }
    });
    return NextResponse.json({ error: { code: "invalid_credentials", message: "รหัส IT ไม่ถูกต้อง" } }, { status: 401 });
  }

  await service.from("login_attempts").insert({
    user_id: matched.id,
    login_method: "it_code",
    success: true,
    ip_address: ip,
    user_agent: userAgent,
    metadata: { surface: "it-admin-web", platform_role: matched.platform_role }
  });

  const response = NextResponse.json(
    { data: { redirect_to: "/it-admin", platform_role: matched.platform_role } },
    { headers: { "cache-control": "no-store" } }
  );
  response.cookies.set(IT_SESSION_COOKIE, createItSessionValue(matched.id, matched.platform_role), itSessionCookieOptions);
  return response;
}

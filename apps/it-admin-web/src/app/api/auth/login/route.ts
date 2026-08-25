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

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } }
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{4,12}$/.test(code)) {
      return jsonError(422, "invalid_credentials", "กรุณากรอกรหัส IT ให้ถูกต้อง");
    }

    const service = getServiceClient();
    const ip = requestIp(request);
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
    const since = new Date(Date.now() - 15 * 60_000).toISOString();

    const { count: recentFailures, error: rateError } = await service
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("login_method", "it_code")
      .eq("success", false)
      .eq("ip_address", ip)
      .gte("created_at", since);

    if (rateError) {
      console.error("[it-auth] rate-limit query failed", rateError.message);
      return jsonError(503, "auth_unavailable", "ระบบยืนยันตัวตนไม่พร้อมใช้งาน");
    }
    if ((recentFailures ?? 0) >= 8) {
      return jsonError(429, "too_many_attempts", "ลองรหัสผิดหลายครั้ง กรุณารอประมาณ 15 นาทีแล้วลองใหม่");
    }

    const { data, error } = await service
      .from("users_profiles")
      .select("id,platform_role,is_active,pin_hash")
      .in("platform_role", ["it_admin", "it_support"])
      .eq("is_active", true)
      .not("pin_hash", "is", null)
      .limit(20);

    if (error) {
      console.error("[it-auth] profile lookup failed", error.message);
      return jsonError(503, "auth_unavailable", "ระบบยืนยันตัวตนไม่พร้อมใช้งาน");
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
      const { error: auditError } = await service.from("login_attempts").insert({
        login_method: "it_code",
        success: false,
        failure_reason: "invalid_code",
        ip_address: ip,
        user_agent: userAgent,
        metadata: { surface: "it-admin-web" }
      });
      if (auditError) {
        console.error("[it-auth] failed-login audit failed", auditError.message);
        return jsonError(503, "auth_unavailable", "ระบบยืนยันตัวตนไม่พร้อมใช้งาน");
      }
      return jsonError(401, "invalid_credentials", "รหัส IT ไม่ถูกต้อง");
    }

    const { error: successAuditError } = await service.from("login_attempts").insert({
      user_id: matched.id,
      login_method: "it_code",
      success: true,
      ip_address: ip,
      user_agent: userAgent,
      metadata: { surface: "it-admin-web", platform_role: matched.platform_role }
    });
    if (successAuditError) {
      console.error("[it-auth] success-login audit failed", successAuditError.message);
      return jsonError(503, "auth_unavailable", "ระบบยืนยันตัวตนไม่พร้อมใช้งาน");
    }

    const response = NextResponse.json(
      { data: { redirect_to: "/it-admin", platform_role: matched.platform_role } },
      { headers: { "cache-control": "no-store" } }
    );
    response.cookies.set(
      IT_SESSION_COOKIE,
      createItSessionValue(matched.id, matched.platform_role),
      itSessionCookieOptions
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown IT authentication error";
    console.error("[it-auth] unexpected login failure", message);

    if (message.startsWith("Missing required environment variable:")) {
      const missingName = message.slice("Missing required environment variable:".length).trim();
      return jsonError(
        503,
        "runtime_config_missing",
        `Vercel IT ยังตั้งค่า Environment Variable ไม่ครบ: ${missingName}`
      );
    }

    return jsonError(500, "internal_error", "ระบบ IT Login เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  }
}

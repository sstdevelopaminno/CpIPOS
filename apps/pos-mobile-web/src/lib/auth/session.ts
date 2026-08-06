import "server-only";

import { cookies } from "next/headers";
import { decodeMobileSessionToken, encodeMobileSessionToken } from "@/lib/auth/session-token";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import type { MobileScope } from "@/types/contracts";

export async function setMobileSessionCookie(scope: MobileScope) {
  const env = getEnv();
  const exp = Date.now() + env.MOBILE_SESSION_TTL_HOURS * 3600000;
  const token = encodeMobileSessionToken(scope, exp);
  (await cookies()).set(env.MOBILE_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(exp)
  });
}

export async function clearMobileSessionCookie() {
  (await cookies()).delete(getEnv().MOBILE_SESSION_COOKIE_NAME);
}

export async function readMobileSession(): Promise<MobileScope | null> {
  const raw = (await cookies()).get(getEnv().MOBILE_SESSION_COOKIE_NAME)?.value;
  return raw ? decodeMobileSessionToken(raw) : null;
}

type PosSessionAuthRow = {
  id: string;
  status: string | null;
  expires_at: string | null;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  device_id: string | null;
  device_code: string | null;
  role: string | null;
};

function isUsableSessionForScope(session: PosSessionAuthRow, scope: MobileScope) {
  if (session.status !== "active") return false;
  if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) return false;
  if (session.device_code !== scope.deviceCode || session.role !== scope.role) return false;
  if (session.device_id && session.device_id !== scope.deviceId) return false;
  return true;
}

function scopeWithRecoveredSession(scope: MobileScope, session: PosSessionAuthRow): MobileScope {
  return {
    ...scope,
    sessionId: session.id,
    deviceId: session.device_id ?? scope.deviceId,
    deviceCode: session.device_code ?? scope.deviceCode,
    role: session.role === "owner" || session.role === "manager" || session.role === "staff" || session.role === "accountant" ? session.role : scope.role,
  };
}

export async function requireActiveMobileSession(options: { refreshCookie?: boolean } = {}): Promise<MobileScope | null> {
  const scope = await readMobileSession();
  if (!scope) return null;

  const supabase = createServiceClient();
  const { data: session, error } = await supabase
    .from("pos_sessions")
    .select("id,status,expires_at,tenant_id,branch_id,user_id,device_id,device_code,role")
    .eq("id", scope.sessionId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .maybeSingle<PosSessionAuthRow>();
  if (error) return null;

  if (session && isUsableSessionForScope(session, scope)) {
    if (options.refreshCookie) await setMobileSessionCookie(scope);
    return scope;
  }

  const { data: recovered } = await supabase
    .from("pos_sessions")
    .select("id,status,expires_at,tenant_id,branch_id,user_id,device_id,device_code,role")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .eq("device_code", scope.deviceCode)
    .eq("role", scope.role)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PosSessionAuthRow>();

  if (!recovered || !isUsableSessionForScope(recovered, scope)) return null;
  const recoveredScope = scopeWithRecoveredSession(scope, recovered);
  if (options.refreshCookie) await setMobileSessionCookie(recoveredScope);
  return recoveredScope;
}

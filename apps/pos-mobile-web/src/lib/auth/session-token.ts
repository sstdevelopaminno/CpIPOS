import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../env";
import type { MobileScope } from "../../types/contracts";

function sign(value: string) {
  return createHmac("sha256", getEnv().MOBILE_SESSION_SECRET).update(value).digest("base64url");
}

export function encodeMobileSessionToken(scope: MobileScope, exp: number) {
  const payload = Buffer.from(JSON.stringify({ ...scope, exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeMobileSessionToken(raw: string): MobileScope | null {
  const [payload, signature] = String(raw ?? "").split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MobileScope & { exp?: number };
    if (!parsed.exp || parsed.exp <= Date.now()) return null;
    if (!parsed.tenantId || !parsed.branchId || !parsed.userId || !parsed.role || !parsed.sessionId || !parsed.deviceId || !parsed.deviceCode) return null;
    return {
      tenantId: parsed.tenantId,
      branchId: parsed.branchId,
      userId: parsed.userId,
      role: parsed.role,
      sessionId: parsed.sessionId,
      deviceId: parsed.deviceId,
      deviceCode: parsed.deviceCode,
      deviceName: parsed.deviceName ?? null
    };
  } catch {
    return null;
  }
}

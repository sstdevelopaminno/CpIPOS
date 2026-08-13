import "server-only";

import crypto from "node:crypto";
import type { NextResponse } from "next/server";
import { readRequiredEnv } from "@/lib/env";

export type KitchenZoneSession = {
  tenant_id: string;
  branch_id: string;
  kitchen_zone_id: string;
  iat: number;
  exp: number;
};

type SignedKitchenZonePayload = {
  v: 1;
  data: KitchenZoneSession;
};

type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

const DEFAULT_TTL_SECONDS = 18 * 60 * 60;
export const KITCHEN_ZONE_SESSION_COOKIE = "cpipos_kds_zone_session";
export const LEGACY_KITCHEN_ZONE_COOKIE = "cpipos_kds_zone_id";

function kitchenZoneSecret() {
  const custom = String(process.env.KITCHEN_ZONE_SESSION_SECRET ?? "").trim();
  if (custom) return custom;
  return readRequiredEnv("POS_SESSION_HANDOFF_SECRET");
}

function resolveTtlSeconds() {
  const raw = Number(process.env.KITCHEN_ZONE_SESSION_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_TTL_SECONDS;
  const ttl = Math.trunc(raw);
  if (ttl < 60 || ttl > 24 * 60 * 60) return DEFAULT_TTL_SECONDS;
  return ttl;
}

function resolveCookieSecurity() {
  const secureEnv = String(process.env.POS_SESSION_COOKIE_SECURE ?? "").trim().toLowerCase();
  if (!secureEnv) return process.env.NODE_ENV === "production";
  return secureEnv === "1" || secureEnv === "true";
}

function resolveCookieDomain() {
  return String(process.env.POS_SESSION_COOKIE_DOMAIN ?? "").trim() || undefined;
}

function sign(encoded: string) {
  return crypto.createHmac("sha256", kitchenZoneSecret()).update(encoded).digest("base64url");
}

function secureEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encodePayload(payload: SignedKitchenZonePayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(raw: string): SignedKitchenZonePayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SignedKitchenZonePayload;
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1 || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createKitchenZoneSession(input: {
  tenantId: string;
  branchId: string;
  kitchenZoneId: string;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ? Math.max(60, Math.min(24 * 60 * 60, Math.trunc(input.ttlSeconds))) : resolveTtlSeconds();
  const payload = encodePayload({
    v: 1,
    data: {
      tenant_id: input.tenantId,
      branch_id: input.branchId,
      kitchen_zone_id: input.kitchenZoneId,
      iat: now,
      exp: now + ttl
    }
  });
  return `${payload}.${sign(payload)}`;
}

export function readKitchenZoneSession(
  cookieStore: CookieReader,
  expected: { tenantId: string; branchId: string }
): KitchenZoneSession | null {
  const token = cookieStore.get(KITCHEN_ZONE_SESSION_COOKIE)?.value?.trim() ?? "";
  if (!token) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  if (!secureEquals(signature, sign(encoded))) return null;
  const payload = decodePayload(encoded);
  if (!payload) return null;
  const session = payload.data;
  const now = Math.floor(Date.now() / 1000);
  if (!session.kitchen_zone_id || !session.tenant_id || !session.branch_id) return null;
  if (!Number.isFinite(session.exp) || session.exp <= now) return null;
  if (session.tenant_id !== expected.tenantId || session.branch_id !== expected.branchId) return null;
  return session;
}

export function writeKitchenZoneSession(
  response: NextResponse,
  input: { tenantId: string; branchId: string; kitchenZoneId: string }
) {
  const maxAge = resolveTtlSeconds();
  response.cookies.set({
    name: KITCHEN_ZONE_SESSION_COOKIE,
    value: createKitchenZoneSession({ ...input, ttlSeconds: maxAge }),
    httpOnly: true,
    secure: resolveCookieSecurity(),
    sameSite: "lax",
    domain: resolveCookieDomain(),
    path: "/",
    maxAge
  });
  response.cookies.set({
    name: LEGACY_KITCHEN_ZONE_COOKIE,
    value: "",
    httpOnly: true,
    secure: resolveCookieSecurity(),
    sameSite: "lax",
    domain: resolveCookieDomain(),
    path: "/",
    maxAge: 0
  });
}

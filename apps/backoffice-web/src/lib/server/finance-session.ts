import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { readRequiredEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { hasAllBranchAccountingGrant } from "@/lib/finance-branch-access";

const COOKIE_NAME = "cpi_finance_session";
const SESSION_SECONDS = 60 * 60;

type FinanceToken = {
  aud: "cpi-finance-v1";
  tenantId: string;
  userId: string;
  iat: number;
  exp: number;
};

type CookieReader = { get: (name: string) => { value: string } | undefined };

export type FinanceIdentity = {
  tenantId: string;
  userId: string;
  name: string | null;
  branchIds: string[];
};

function signature(encoded: string): Buffer {
  // Purpose separation: the finance token is NOT a POS session or pre-entry token.
  return crypto.createHmac("sha256", readRequiredEnv("POS_SESSION_HANDOFF_SECRET"))
    .update("cpi-finance-v1:")
    .update(encoded)
    .digest();
}

function decodeFinanceToken(value: string): FinanceToken | null {
  if (!value || value.length > 2048) return null;
  const pieces = value.split(".");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return null;
  const actual = Buffer.from(pieces[1], "base64url");
  const expected = signature(pieces[0]);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8")) as FinanceToken;
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== "cpi-finance-v1" || !payload.tenantId || !payload.userId ||
      !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) ||
      payload.iat > now + 60 || payload.exp <= now || payload.exp > payload.iat + SESSION_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function writeFinanceSession(response: NextResponse, tenantId: string, userId: string): void {
  const now = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify({
    aud: "cpi-finance-v1", tenantId, userId, iat: now, exp: now + SESSION_SECONDS
  } satisfies FinanceToken)).toString("base64url");
  response.cookies.set({
    name: COOKIE_NAME,
    value: `${encoded}.${signature(encoded).toString("base64url")}`,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS
  });
}

export function clearFinanceSession(response: NextResponse): void {
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export async function verifyFinanceIdentity(tenantId: string, userId: string): Promise<FinanceIdentity | null> {
  const db = getSupabaseServiceClient();
  // Server-read authoritative data. A branch assignment does not grant tenant-wide access.
  const [tenantResult, userResult, branchResult, rolesResult] = await Promise.all([
    db.from("tenants").select("id,is_active").eq("id", tenantId).maybeSingle(),
    db.from("users_profiles").select("id,full_name,is_active").eq("id", userId).maybeSingle(),
    db.from("branches").select("id").eq("tenant_id", tenantId).eq("is_active", true),
    db.from("user_branch_roles").select("branch_id,role").eq("tenant_id", tenantId).eq("user_id", userId)
  ]);
  if (tenantResult.error || userResult.error || branchResult.error || rolesResult.error) {
    throw new Error("finance_identity_lookup_failed");
  }
  if (!tenantResult.data?.is_active || !userResult.data?.is_active) return null;
  const branchIds = (branchResult.data ?? []).map((branch) => String(branch.id));
  if (branchIds.length === 0) return null;
  // Fail closed until Owner assigns accountant to EVERY active branch.
  if (!hasAllBranchAccountingGrant(branchIds, rolesResult.data ?? [])) return null;
  return {
    tenantId,
    userId,
    name: userResult.data.full_name ?? null,
    branchIds
  };
}

export async function requireFinanceSession(): Promise<FinanceIdentity | null> {
  const store = await cookies();
  const token = decodeFinanceToken(store.get(COOKIE_NAME)?.value ?? "");
  if (!token) return null;
  return verifyFinanceIdentity(token.tenantId, token.userId);
}

import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import type { BranchRole } from "@/types/contracts";

export type MobileFlowStage = "store_verified" | "branch_selected" | "employee_verified";

export type MobileLoginFlow = {
  stage: MobileFlowStage;
  contextId: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  userId?: string | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  role?: BranchRole | null;
  deviceId?: string | null;
  deviceCode?: string | null;
  deviceName?: string | null;
  iat: number;
  exp: number;
};

const COOKIE_NAME = "sstipos_mobile_login_flow";

function ttlSeconds() {
  return getEnv().MOBILE_LOGIN_CONTEXT_TTL_MINUTES * 60;
}

function secret() {
  return getEnv().MOBILE_SESSION_SECRET;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function encode(flow: MobileLoginFlow) {
  const payload = Buffer.from(JSON.stringify({ v: 1, flow }), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(token: string): MobileLoginFlow | null {
  const [payload, signature] = String(token ?? "").split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v: number; flow: MobileLoginFlow };
    if (parsed.v !== 1 || !parsed.flow) return null;
    if (parsed.flow.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed.flow;
  } catch {
    return null;
  }
}

export function createMobileFlow(input: Omit<MobileLoginFlow, "iat" | "exp">): MobileLoginFlow {
  const now = Math.floor(Date.now() / 1000);
  return { ...input, iat: now, exp: now + ttlSeconds() };
}

export async function readMobileFlow() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return token ? decode(token) : null;
}

export function writeMobileFlow(response: NextResponse, flow: MobileLoginFlow) {
  response.cookies.set(COOKIE_NAME, encode(flow), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttlSeconds()
  });
}

export function clearMobileFlow(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

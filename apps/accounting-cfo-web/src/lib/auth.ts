import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type AccountingRole = "cfo" | "marketing";

const COOKIE_NAME = "cp_accounting_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

type SessionPayload = {
  role: AccountingRole;
  exp: number;
};

function secret() {
  const value = process.env.ACCOUNTING_SESSION_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("ACCOUNTING_SESSION_SECRET must be configured with at least 32 characters.");
  }
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqualText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyAccessKey(role: AccountingRole, provided: string) {
  const expected =
    role === "cfo"
      ? process.env.ACCOUNTING_CFO_ACCESS_KEY
      : process.env.ACCOUNTING_MARKETING_ACCESS_KEY;

  if (!expected || expected.length < 16) return false;
  return safeEqualText(provided, expected);
}

function encodeSession(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

function decodeSession(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature || !safeEqualText(sign(body), signature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!["cfo", "marketing"].includes(payload.role)) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(role: AccountingRole) {
  const store = await cookies();
  const payload: SessionPayload = {
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };

  store.set(COOKIE_NAME, encodeSession(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession() {
  const store = await cookies();
  return decodeSession(store.get(COOKIE_NAME)?.value);
}

export async function requireSession(roles?: AccountingRole[]) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (roles && !roles.includes(session.role)) redirect("/");
  return session;
}

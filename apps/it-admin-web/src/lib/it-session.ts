import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { readRequiredEnv } from "@/lib/env";

export const IT_SESSION_COOKIE = "cpipos_it_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

type ItSessionPayload = {
  v: 1;
  userId: string;
  role: "it_admin" | "it_support";
  exp: number;
};

function sign(value: string) {
  return createHmac("sha256", readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"))
    .update(`it-control-plane:${value}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createItSessionValue(userId: string, role: "it_admin" | "it_support") {
  const payload: ItSessionPayload = {
    v: 1,
    userId,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export async function readItSession(): Promise<ItSessionPayload | null> {
  const store = await cookies();
  const raw = store.get(IT_SESSION_COOKIE)?.value;
  if (!raw) return null;
  const [encoded, signature, extra] = raw.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ItSessionPayload;
    if (payload.v !== 1 || !payload.userId || (payload.role !== "it_admin" && payload.role !== "it_support")) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const itSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS
};

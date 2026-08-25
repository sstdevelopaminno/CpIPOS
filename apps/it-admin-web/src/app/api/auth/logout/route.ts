import { NextResponse } from "next/server";
import { IT_SESSION_COOKIE } from "@/lib/it-session";

export async function POST() {
  const response = NextResponse.json({ data: { ok: true } }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(IT_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return response;
}

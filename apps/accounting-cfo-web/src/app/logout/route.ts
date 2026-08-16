import { clearSession } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await clearSession();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}

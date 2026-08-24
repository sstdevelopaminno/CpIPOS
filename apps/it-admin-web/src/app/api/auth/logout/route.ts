import { NextResponse } from "next/server";
import { getServerAuthClient } from "@/lib/supabase";

export async function POST() {
  const auth = await getServerAuthClient();
  await auth.auth.signOut();
  return NextResponse.json({ data: { ok: true } }, { headers: { "cache-control": "no-store" } });
}

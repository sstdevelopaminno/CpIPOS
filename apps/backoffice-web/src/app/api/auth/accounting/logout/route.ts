import { NextResponse } from "next/server";
import { clearFinanceSession } from "@/lib/server/finance-session";

export async function POST() {
  const response = NextResponse.json(
    { data: { redirect_to: "/login/store" }, error: null },
    { headers: { "Cache-Control": "no-store" } }
  );
  clearFinanceSession(response);
  return response;
}

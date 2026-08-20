import { NextResponse } from "next/server";

const dualScreenApkUrl =
  "https://github.com/sstdevelopaminno/CpIPOS/releases/download/android-runtime-dual-screen-1-0-13/CpIPOS-Android-POS-1.0.13-Dual-Screen.apk";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.redirect(dualScreenApkUrl, 302);
}

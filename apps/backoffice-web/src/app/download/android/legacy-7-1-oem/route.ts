import { NextResponse } from "next/server";

const legacyOemApkUrl =
  "https://github.com/sstdevelopaminno/CpIPOS/releases/download/android-runtime-legacy-7-1-oem/CpIPOS-Android-POS-Legacy-Android-7.1-OEM.apk";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.redirect(legacyOemApkUrl, 302);
}

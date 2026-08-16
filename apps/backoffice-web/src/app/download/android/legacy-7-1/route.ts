import { NextResponse } from "next/server";

const legacyApkUrl =
  "https://github.com/sstdevelopaminno/CpIPOS/releases/download/android-runtime-legacy-7-1/CpIPOS-Android-POS-Legacy-Android-7.1.apk";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.redirect(legacyApkUrl, 302);
}

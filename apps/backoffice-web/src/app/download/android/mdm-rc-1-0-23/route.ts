import { NextResponse } from "next/server";

// This URL is intentionally separate from Android Modern and Legacy channels.
// It serves only the exact user-supplied MDM RC DEBUG APK after publication.
const RELEASE_API = "https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases/tags/android-runtime-mdm-rc-1.0.23";
const EXPECTED_SHA256 = "be39040de53bbd134ff958ef62faa932f1c48784906ef1f4d4216d1546e85d73";
const ASSET_NAMES = new Set([
  "CpIPOS-Android-POS-1.0.23-MDM-RC-DEBUG.apk",
  "CpIPOS-Android-POS-1.0.23-MDM-RC-DEBUG(2).apk",
  "CpIPOS-Android-POS-1.0.23-MDM-RC-DEBUG(3).apk"
]);

type ReleaseAsset = {
  name?: string;
  digest?: string;
  browser_download_url?: string;
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(RELEASE_API, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-Android-MDM-RC-Download"
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) return notReady();

    const release = (await response.json()) as { assets?: ReleaseAsset[] };
    const asset = release.assets?.find(
      (item) => ASSET_NAMES.has(item.name || "") &&
        item.digest?.toLowerCase() === "sha256:" + EXPECTED_SHA256 &&
        Boolean(item.browser_download_url)
    );

    if (!asset?.browser_download_url) return notReady();

    const redirect = NextResponse.redirect(asset.browser_download_url, 302);
    redirect.headers.set("Cache-Control", "no-store");
    redirect.headers.set("X-CpIPOS-Android-Release", "1.0.23-mdm-rc-debug");
    return redirect;
  } catch {
    return notReady();
  }
}

function notReady() {
  return new NextResponse(
    '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>กำลังเตรียมไฟล์ Android</title></head><body style="background:#061327;color:white;font-family:Tahoma,Arial,sans-serif;min-height:100vh;display:grid;place-items:center;text-align:center;padding:20px;box-sizing:border-box"><main><h1>กำลังเตรียมไฟล์ Android รุ่นทดสอบ</h1><p>ไฟล์ MDM RC DEBUG ยังไม่พร้อมให้ดาวน์โหลด กรุณาลองใหม่ภายหลัง</p><a style="color:#7dd3fc" href="/download">กลับหน้าดาวน์โหลด</a></main></body></html>',
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

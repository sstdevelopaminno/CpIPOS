import { NextResponse } from "next/server";
import { ANDROID_MODERN_RELEASE } from "@/lib/android-runtime-release";

const releaseApiUrl = `https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases/tags/${ANDROID_MODERN_RELEASE.releaseTag}`;

export const dynamic = "force-dynamic";

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

export async function GET() {
  try {
    const response = await fetch(releaseApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-AndroidModernRuntime-Download"
      }
    });

    if (!response.ok) {
      return notReady(`ไฟล์ APK ของ CpIPOS Android POS Modern ${ANDROID_MODERN_RELEASE.versionName} กำลังถูกสร้าง กรุณารอสักครู่แล้วกดดาวน์โหลดอีกครั้ง`);
    }

    const release = (await response.json()) as { assets?: ReleaseAsset[] };
    const asset = release.assets?.find(
      (item) => item.name === ANDROID_MODERN_RELEASE.assetName && Boolean(item.browser_download_url)
    );

    if (!asset?.browser_download_url) {
      return notReady(`พบหน้า Modern Release แล้ว แต่ Android POS ${ANDROID_MODERN_RELEASE.versionName} ยังสร้าง Stable Signed APK ไม่เสร็จ กรุณารอสักครู่แล้วลองใหม่`);
    }

    const redirect = NextResponse.redirect(asset.browser_download_url, 302);
    redirect.headers.set("X-CpIPOS-Android-Version", ANDROID_MODERN_RELEASE.versionName);
    redirect.headers.set("X-CpIPOS-Android-Version-Code", String(ANDROID_MODERN_RELEASE.versionCode));
    redirect.headers.set("X-CpIPOS-Android-Channel", ANDROID_MODERN_RELEASE.channel);
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  } catch {
    return notReady(`ยังตรวจสอบไฟล์ Android POS Modern ${ANDROID_MODERN_RELEASE.versionName} ไม่ได้ กรุณาลองใหม่อีกครั้ง`);
  }
}

function notReady(reason: string) {
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Android Modern ${ANDROID_MODERN_RELEASE.versionName} กำลังเตรียม APK</title>
  <style>
    body{margin:0;min-height:100vh;background:#020617;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    main{max-width:780px;border:1px solid #334155;border-radius:24px;background:#0f172a;padding:28px;box-sizing:border-box;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:28px;margin:0 0 12px}p{line-height:1.7;color:#cbd5e1}.note{display:block;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px;color:#bae6fd}.btn{display:inline-block;margin-top:16px;border-radius:14px;background:#0ea5e9;color:white;padding:12px 18px;text-decoration:none;font-weight:700}.muted{color:#94a3b8;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>CpIPOS Android POS Modern ${ANDROID_MODERN_RELEASE.versionName}</h1>
    <p>ระบบกำลังสร้างและตรวจสอบ Signed APK ของสาย Modern ผ่าน GitHub Actions เมื่อไฟล์พร้อม ปุ่มดาวน์โหลดจะพาไปยัง APK ที่ตรวจ certificate แล้ว</p>
    <span class="note">${escapeHtml(reason)}</span>
    <a class="btn" href="/download">กลับไปหน้าดาวน์โหลด</a>
    <p class="muted">Stable 1.0.12 ยังคงเป็นคนละ release channel และจะไม่ถูกแทนที่ระหว่างการเตรียม Modern Runtime</p>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

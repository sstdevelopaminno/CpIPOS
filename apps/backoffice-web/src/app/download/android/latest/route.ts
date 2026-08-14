import { NextResponse } from "next/server";

const releaseApiUrl = "https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases/tags/android-runtime-latest";
const stableAssetName = "CpIPOS-Android-POS.apk";
const versionedAssetPattern = /^CpIPOS-Android-POS-(\d+)\.(\d+)\.(\d+)\.apk$/;

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
        "User-Agent": "CpIPOS-AndroidRuntime-Download"
      }
    });

    if (!response.ok) {
      return notReady("ไฟล์ APK ของ CpIPOS Android กำลังถูกสร้าง กรุณารอสักครู่แล้วกดดาวน์โหลดอีกครั้ง");
    }

    const release = (await response.json()) as { assets?: ReleaseAsset[] };
    const assets = release.assets ?? [];

    // The release workflow always clobbers this stable alias after a signed production build.
    // Keeping the web route on the alias means future Android releases do not require another URL change.
    const stableAsset = assets.find(
      (item) => item.name === stableAssetName && Boolean(item.browser_download_url)
    );

    const fallbackAsset = assets
      .map((asset) => ({ asset, version: parseVersion(asset.name) }))
      .filter((entry): entry is { asset: ReleaseAsset; version: [number, number, number] } => Boolean(entry.version))
      .sort((a, b) => compareVersion(b.version, a.version))[0]?.asset;

    const asset = stableAsset ?? fallbackAsset;
    if (!asset?.browser_download_url) {
      return notReady("พบหน้า Release แล้ว แต่ยังไม่พบ Stable APK กรุณารอสักครู่แล้วกดดาวน์โหลดอีกครั้ง");
    }

    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch {
    return notReady("ยังตรวจสอบไฟล์ APK ไม่ได้ กรุณาลองใหม่อีกครั้ง");
  }
}

function parseVersion(name?: string): [number, number, number] | null {
  if (!name) return null;
  const match = versionedAssetPattern.exec(name);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(a: [number, number, number], b: [number, number, number]) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function notReady(reason: string) {
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Android กำลังเตรียม APK</title>
  <style>
    body{margin:0;min-height:100vh;background:#020617;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    main{max-width:780px;border:1px solid #334155;border-radius:24px;background:#0f172a;padding:28px;box-sizing:border-box;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:28px;margin:0 0 12px}p{line-height:1.7;color:#cbd5e1}.note{display:block;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px;color:#bae6fd}.btn{display:inline-block;margin-top:16px;border-radius:14px;background:#0ea5e9;color:white;padding:12px 18px;text-decoration:none;font-weight:700}.muted{color:#94a3b8;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>CpIPOS Android กำลังเตรียม APK</h1>
    <p>ระบบกำลังสร้าง Stable Signed APK ผ่าน GitHub Actions เมื่อสร้างเสร็จ URL เดิมนี้จะดาวน์โหลดเวอร์ชันล่าสุดได้ทันที</p>
    <span class="note">${escapeHtml(reason)}</span>
    <a class="btn" href="/download">กลับไปหน้าดาวน์โหลด</a>
    <p class="muted">CpIPOS Web ยังใช้งานได้ตามปกติ หน้านี้เป็นไฟล์ APK สำหรับ Android เท่านั้น</p>
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

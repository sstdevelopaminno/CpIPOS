import { NextResponse } from "next/server";

const releaseTag = "android-runtime-modern-1.0.23";
const expectedVersion = "1.0.23";
const expectedAssetName = `CpIPOS-Android-POS-${expectedVersion}.apk`;
const releaseApiUrl = `https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases/tags/${releaseTag}`;

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
        "User-Agent": "CpIPOS-Android-Download"
      }
    });

    if (!response.ok) {
      return notReady(`ยังไม่พบ Release ${releaseTag} สำหรับ Android POS`);
    }

    const release = (await response.json()) as { assets?: ReleaseAsset[] };
    const asset = release.assets?.find(
      (item) => item.name === expectedAssetName && Boolean(item.browser_download_url)
    );

    if (!asset?.browser_download_url) {
      return notReady(`พบ Release ${releaseTag} แล้ว แต่ยังไม่พบไฟล์ ${expectedAssetName}`);
    }

    const redirect = NextResponse.redirect(asset.browser_download_url, 302);
    redirect.headers.set("X-CpIPOS-Android-Version", expectedVersion);
    redirect.headers.set("X-CpIPOS-Android-Channel", "modern");
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  } catch {
    return notReady(`ยังตรวจสอบไฟล์ Android POS ${expectedVersion} ไม่ได้ กรุณาลองใหม่อีกครั้ง`);
  }
}

function notReady(reason: string) {
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Android ${expectedVersion}</title>
  <style>
    body{margin:0;min-height:100vh;background:#020617;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    main{max-width:720px;border:1px solid #334155;border-radius:24px;background:#0f172a;padding:28px;box-sizing:border-box;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:26px;margin:0 0 12px}p{line-height:1.7;color:#cbd5e1}.note{display:block;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px;color:#bae6fd}.btn{display:inline-block;margin-top:16px;border-radius:14px;background:#0ea5e9;color:white;padding:12px 18px;text-decoration:none;font-weight:700}
  </style>
</head>
<body>
  <main>
    <h1>CpIPOS Android POS ${expectedVersion}</h1>
    <p>ระบบยังไม่สามารถเปิดไฟล์ดาวน์โหลดได้ในขณะนี้</p>
    <span class="note">${escapeHtml(reason)}</span>
    <a class="btn" href="/download">กลับไปหน้าดาวน์โหลด</a>
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

import { NextResponse } from "next/server";

const releasesApiUrl = "https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases?per_page=30";
const stableNativeTagPattern = /^native-mobile-v\d+\.\d+\.\d+$/;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(releasesApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-Mobile-Download"
      }
    });

    if (!response.ok) {
      return notReady("ยังตรวจสอบ CpIPOS Native Mobile รุ่น Stable จาก GitHub Releases ไม่ได้ กรุณาลองใหม่อีกครั้ง");
    }

    const releases = (await response.json()) as Array<{
      draft?: boolean;
      prerelease?: boolean;
      tag_name?: string;
      assets?: Array<{
        name?: string;
        browser_download_url?: string;
      }>;
    }>;

    const release = releases.find(
      (item) =>
        !item.draft &&
        !item.prerelease &&
        typeof item.tag_name === "string" &&
        stableNativeTagPattern.test(item.tag_name),
    );

    const asset = release?.assets?.find(
      (item) =>
        typeof item.name === "string" &&
        item.name.startsWith("CpIPOS-Native-Mobile-") &&
        item.name.endsWith(".apk"),
    );

    if (!asset?.browser_download_url) {
      return notReady("ยังไม่พบ CpIPOS Native Mobile รุ่น Stable ที่พร้อมดาวน์โหลด กรุณาลองใหม่อีกครั้ง");
    }

    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch {
    return notReady("ยังตรวจสอบไฟล์ CpIPOS Mobile APK ไม่ได้ กรุณาลองใหม่อีกครั้ง");
  }
}

function notReady(reason: string) {
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Mobile กำลังเตรียม APK</title>
  <style>
    body{margin:0;min-height:100vh;background:#020617;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    main{max-width:780px;border:1px solid #334155;border-radius:24px;background:#0f172a;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:28px;margin:0 0 12px}p{line-height:1.7;color:#cbd5e1}.note{display:block;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px;color:#bae6fd}.btn{display:inline-block;margin-top:16px;border-radius:14px;background:#0ea5e9;color:white;padding:12px 18px;text-decoration:none;font-weight:700}.muted{color:#94a3b8;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>CpIPOS Mobile กำลังเตรียม APK</h1>
    <p>ระบบกำลังสร้าง Native Android APK ผ่าน GitHub Actions เมื่อ Release พร้อม ปุ่มดาวน์โหลดเดิมจะดาวน์โหลดไฟล์ล่าสุดให้อัตโนมัติ</p>
    <span class="note">${escapeHtml(reason)}</span>
    <a class="btn" href="/download/mobile">กลับไปหน้าดาวน์โหลด</a>
    <p class="muted">CpIPOS Mobile ไม่ใช้ WebView และไม่ต้องมี Mobile Hosting แยก</p>
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

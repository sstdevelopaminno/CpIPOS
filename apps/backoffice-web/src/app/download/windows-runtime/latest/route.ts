import { NextResponse } from "next/server";

const releaseApiUrls = [
  "https://api.github.com/repos/sstdevelopaminno/cp-ipos-desktop/releases/latest",
  "https://api.github.com/repos/sstdevelopaminno/cp-ipos-desktop/releases/tags/v0.2.2"
];
const preferredAssetNames = [
  "CpIPOS Desktop_0.2.2_x64-setup.exe",
  "CpIPOS Desktop_0.2.2_x64_en-US.msi",
  "CpIPOS-Desktop-Setup.exe",
  "CpIPOS-Desktop-0.2.2-x64.msi",
  "CpIPOS Desktop_0.2.1_x64-setup.exe",
  "CpIPOS Desktop_0.2.1_x64_en-US.msi",
  "CpIPOS-Desktop-0.2.1-x64.msi",
  "CpIPOS-WindowsRuntime-Setup.exe"
];

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const release = await fetchRelease();
    if (!release) {
      return notReady("ไฟล์ติดตั้ง CpIPOS Windows กำลังถูกสร้าง กรุณารอสักครู่แล้วกดดาวน์โหลดอีกครั้ง");
    }

    const asset = preferredAssetNames
      .map((name) => release.assets?.find((item) => item.name === name))
      .find(Boolean) ?? release.assets?.find((item) => /CpIPOS[\s-]*Desktop.*(setup|x64).*\.(exe|msi)$/i.test(item.name ?? ""));
    if (!asset?.browser_download_url) {
      return notReady("พบหน้า Release แล้ว แต่ไฟล์ติดตั้ง CpIPOS Windows ยังไม่ถูกแนบ กรุณารอสักครู่แล้วกดดาวน์โหลดอีกครั้ง");
    }

    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch {
    return notReady("ยังตรวจสอบไฟล์ติดตั้งไม่ได้ กรุณาลองใหม่อีกครั้ง");
  }
}

async function fetchRelease() {
  for (const url of releaseApiUrls) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-WindowsRuntime-Download"
      }
    });

    if (response.ok) {
      return (await response.json()) as {
        assets?: Array<{
          name?: string;
          browser_download_url?: string;
        }>;
      };
    }
  }

  return null;
}

function notReady(reason: string) {
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Windows กำลังเตรียมตัวติดตั้ง</title>
  <style>
    body{margin:0;min-height:100vh;background:#020617;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    main{max-width:780px;border:1px solid #334155;border-radius:24px;background:#0f172a;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:28px;margin:0 0 12px}p{line-height:1.7;color:#cbd5e1}.note{display:block;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px;color:#bae6fd}.btn{display:inline-block;margin-top:16px;border-radius:14px;background:#0ea5e9;color:white;padding:12px 18px;text-decoration:none;font-weight:700}.muted{color:#94a3b8;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>CpIPOS Windows กำลังเตรียมตัวติดตั้ง</h1>
    <p>ระบบกำลังสร้างไฟล์ติดตั้งสำหรับ Windows ผ่าน GitHub Actions เมื่อสร้างเสร็จ ปุ่มดาวน์โหลดเดิมจะดาวน์โหลดไฟล์ติดตั้งได้ทันที</p>
    <span class="note">${escapeHtml(reason)}</span>
    <a class="btn" href="/download">กลับไปหน้าดาวน์โหลด</a>
    <p class="muted">CpIPOS Web ยังใช้งานแยกได้ตามปกติ หน้านี้เป็นไฟล์ติดตั้งสำหรับ Windows เท่านั้น</p>
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

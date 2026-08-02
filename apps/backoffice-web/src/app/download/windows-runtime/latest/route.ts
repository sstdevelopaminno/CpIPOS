import { NextResponse } from "next/server";

const releaseApiUrl = "https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases/tags/windows-runtime-latest";
const assetName = "CpIPOS-WindowsRuntime-win-x64.zip";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(releaseApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-WindowsRuntime-Download"
      }
    });

    if (!response.ok) {
      return notReady(`ยังไม่พบ Release สำหรับ Windows Runtime (${response.status})`);
    }

    const release = (await response.json()) as {
      assets?: Array<{
        name?: string;
        browser_download_url?: string;
      }>;
    };

    const asset = release.assets?.find((item) => item.name === assetName);
    if (!asset?.browser_download_url) {
      return notReady("พบ Release แล้ว แต่ยังไม่พบไฟล์ Windows Runtime ZIP");
    }

    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch (error) {
    return notReady(error instanceof Error ? error.message : "ไม่สามารถตรวจไฟล์ดาวน์โหลดได้");
  }
}

function notReady(reason: string) {
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Windows Runtime ยังไม่พร้อมดาวน์โหลด</title>
  <style>
    body{margin:0;min-height:100vh;background:#020617;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    main{max-width:760px;border:1px solid #334155;border-radius:24px;background:#0f172a;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:28px;margin:0 0 12px}p{line-height:1.7;color:#cbd5e1}code{display:block;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px;overflow:auto;color:#bae6fd}.btn{display:inline-block;margin-top:16px;border-radius:14px;background:#0ea5e9;color:white;padding:12px 18px;text-decoration:none;font-weight:700}.muted{color:#94a3b8;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>ไฟล์ Windows Runtime ยังไม่พร้อมดาวน์โหลด</h1>
    <p>ระบบกำลังรอ GitHub Actions สร้างไฟล์ ZIP และเผยแพร่เป็นไฟล์ดาวน์โหลดล่าสุด กรุณารอสักครู่แล้วลองใหม่อีกครั้ง</p>
    <code>${escapeHtml(reason)}</code>
    <a class="btn" href="/download/windows-runtime">กลับไปหน้าดาวน์โหลด</a>
    <p class="muted">หน้านี้ใช้แทน GitHub Not Found เพื่อให้ลูกค้าเห็นข้อความที่เข้าใจง่าย</p>
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

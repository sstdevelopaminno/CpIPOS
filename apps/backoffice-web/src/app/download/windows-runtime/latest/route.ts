import { NextResponse } from "next/server";

const DESKTOP_RELEASE_TAG = "v0.2.7";
const DESKTOP_VERSION = DESKTOP_RELEASE_TAG.replace(/^v/, "");
const DESKTOP_REPO = "sstdevelopaminno/cp-ipos-desktop";

const releaseApiUrls = [
  `https://api.github.com/repos/${DESKTOP_REPO}/releases/tags/${DESKTOP_RELEASE_TAG}`,
  `https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`
];

const preferredAssetNames = [
  "CpIPOS.Desktop_0.2.7_x64-setup.exe",
  "CpIPOS Desktop_0.2.7_x64-setup.exe",
  "CpIPOS-Desktop-0.2.7-x64-setup.exe",
  "CpIPOS.Desktop_0.2.7_x64_en-US.msi",
  "CpIPOS Desktop_0.2.7_x64_en-US.msi",
  "CpIPOS-Desktop-0.2.7-x64.msi"
];

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type DesktopRelease = {
  tag_name?: string;
  assets?: ReleaseAsset[];
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const release = await fetchRelease();
    if (!release) {
      return notReady(`ไฟล์ติดตั้ง CpIPOS Windows ${DESKTOP_RELEASE_TAG} กำลังถูกสร้าง กรุณารอสักครู่แล้วกดดาวน์โหลดอีกครั้ง`);
    }

    const asset = findInstallerAsset(release.assets || []);
    if (!asset?.browser_download_url) {
      return notReady(`พบ Release ${DESKTOP_RELEASE_TAG} แล้ว แต่ยังไม่พบไฟล์ติดตั้ง Windows ${DESKTOP_VERSION}`);
    }

    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch {
    return notReady(`ยังตรวจสอบไฟล์ติดตั้ง CpIPOS Desktop ${DESKTOP_VERSION} ไม่ได้ กรุณาลองใหม่อีกครั้ง`);
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
      const release = await response.json() as DesktopRelease;
      if (release.tag_name === DESKTOP_RELEASE_TAG || url.endsWith(DESKTOP_RELEASE_TAG)) return release;
    }
  }

  return null;
}

function findInstallerAsset(assets: ReleaseAsset[]) {
  const exact = preferredAssetNames
    .map((name) => assets.find((item) => item.name === name))
    .find(Boolean);
  if (exact) return exact;

  const versionedSetupPattern = new RegExp(`CpIPOS[\\s._-]*Desktop.*${escapeRegex(DESKTOP_VERSION)}.*setup.*\\.exe$`, "i");
  const versionedWindowsPattern = new RegExp(`CpIPOS[\\s._-]*Desktop.*${escapeRegex(DESKTOP_VERSION)}.*(x64|windows).*\\.(exe|msi)$`, "i");

  return assets.find((item) => versionedSetupPattern.test(item.name || ""))
    || assets.find((item) => versionedWindowsPattern.test(item.name || ""))
    || null;
}

function notReady(reason: string) {
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Desktop ${DESKTOP_VERSION} กำลังเตรียมตัวติดตั้ง</title>
  <style>
    body{margin:0;min-height:100vh;background:#020617;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    main{max-width:780px;border:1px solid #334155;border-radius:24px;background:#0f172a;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:28px;margin:0 0 12px}p{line-height:1.7;color:#cbd5e1}.note{display:block;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px;color:#bae6fd}.btn{display:inline-block;margin-top:16px;border-radius:14px;background:#0ea5e9;color:white;padding:12px 18px;text-decoration:none;font-weight:700}.muted{color:#94a3b8;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>CpIPOS Desktop ${DESKTOP_VERSION} กำลังเตรียมตัวติดตั้ง</h1>
    <p>ระบบกำลังตรวจสอบไฟล์ติดตั้งสำหรับ Windows ผ่าน GitHub Release เมื่อพร้อมแล้วปุ่มดาวน์โหลดเดิมจะใช้งานได้ทันที</p>
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

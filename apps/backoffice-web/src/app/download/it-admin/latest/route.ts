import { NextResponse } from "next/server";

const releaseApiUrl = "https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases/tags/it-admin-runtime-latest";
const assetName = "CpIPOS-ITAdminRuntime-Setup.exe";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(releaseApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-ITAdminRuntime-Download"
      }
    });

    if (!response.ok) return notReady("IT Admin runtime release is not ready yet.");

    const release = (await response.json()) as {
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const asset = release.assets?.find((item) => item.name === assetName);
    if (!asset?.browser_download_url) return notReady("IT Admin runtime installer asset is not attached yet.");

    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch {
    return notReady("Unable to check the IT Admin runtime release right now.");
  }
}

function notReady(reason: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CpIPOS IT Admin Runtime</title></head><body style="font-family:Arial,sans-serif;background:#020617;color:#f8fafc;padding:32px"><main style="max-width:720px;margin:auto"><h1>CpIPOS IT Admin Runtime</h1><p>${escapeHtml(reason)}</p><p><a style="color:#38bdf8" href="/download">Back to CpIPOS downloads</a></p></main></body></html>`,
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
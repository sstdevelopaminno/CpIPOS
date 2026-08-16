import "server-only";

import { createSign } from "node:crypto";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly"
].join(" ");

function serviceAccountConfig() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const privateKey = rawPrivateKey?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Google read-only service account is not configured.");
  }
  return { email, privateKey };
}

function base64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function getAccessToken() {
  const nowMs = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > nowMs) return cachedToken.accessToken;

  const { email, privateKey } = serviceAccountConfig();
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPES,
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    })
  );
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(privateKey, "base64url")}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Google OAuth failed (${response.status}).`);

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google OAuth did not return an access token.");

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: nowMs + Math.max(300, data.expires_in ?? 3600) * 1000
  };
  return cachedToken.accessToken;
}

export async function googleFetch(url: string, init?: RequestInit) {
  const accessToken = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${accessToken}`);

  return fetch(url, {
    ...init,
    headers,
    cache: "no-store"
  });
}

export async function getSheetValues(spreadsheetId: string, range: string) {
  const encodedRange = encodeURIComponent(range);
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`
  );
  if (!response.ok) throw new Error(`Google Sheets read failed (${response.status}).`);

  const data = (await response.json()) as { values?: unknown[][] };
  return (data.values ?? []).map((row) => row.map((value) => String(value ?? "")));
}

export async function getDriveFile(fileId: string) {
  const metadataResponse = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size&supportsAllDrives=true`
  );
  if (!metadataResponse.ok) throw new Error(`Google Drive metadata failed (${metadataResponse.status}).`);
  const metadata = (await metadataResponse.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
  };

  const isNativeGoogleFile = metadata.mimeType.startsWith("application/vnd.google-apps.");
  const contentUrl = isNativeGoogleFile
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application%2Fpdf`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

  const contentResponse = await googleFetch(contentUrl);
  if (!contentResponse.ok) throw new Error(`Google Drive download failed (${contentResponse.status}).`);

  return {
    name: isNativeGoogleFile && !metadata.name.toLowerCase().endsWith(".pdf") ? `${metadata.name}.pdf` : metadata.name,
    mimeType: isNativeGoogleFile ? "application/pdf" : metadata.mimeType || "application/octet-stream",
    bytes: await contentResponse.arrayBuffer()
  };
}

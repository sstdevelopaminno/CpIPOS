import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccountingRole } from "@/lib/auth";

type FileGrant = {
  fileId: string;
  role: AccountingRole;
  exp: number;
};

function secret() {
  const value = process.env.ACCOUNTING_SESSION_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("ACCOUNTING_SESSION_SECRET is not configured.");
  return value;
}

function signature(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function extractDriveFileIds(text: string) {
  const results = new Set<string>();
  const patterns = [
    /drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/g,
    /docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/g,
    /[?&]id=([A-Za-z0-9_-]+)/g
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) results.add(match[1]);
    }
  }
  return [...results];
}

export function createFileGrant(fileId: string, role: AccountingRole, ttlSeconds = 10 * 60) {
  const payload: FileGrant = {
    fileId,
    role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signature(body)}`;
}

export function verifyFileGrant(token: string): FileGrant | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(signature(body), sig)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as FileGrant;
    if (!payload.fileId || !["cfo", "marketing"].includes(payload.role)) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

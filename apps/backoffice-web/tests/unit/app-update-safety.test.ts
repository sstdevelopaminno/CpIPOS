import { describe, expect, it } from "vitest";
import { hasStoredWork, hasLegacyUnsyncedSales, isTrustedAndroidDownload, isUpdateSafeRoute } from "../../src/lib/app-update-safety";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

describe("app update safety", () => {
  it("fails closed for invalid storage and pending carts", () => {
    for (const value of ["{invalid", "[1]", '{"id":"bill"}']) expect(hasStoredWork(value)).toBe(true);
    for (const value of [null, "[]", "{}", "null"]) expect(hasStoredWork(value)).toBe(false);
  });
  it("preserves legacy queued/failed/syncing/unknown sales", () => {
    for (const status of ["queued", "failed", "syncing", "unknown"]) {
      expect(hasLegacyUnsyncedSales(JSON.stringify([{status}]))).toBe(true);
    }
    expect(hasLegacyUnsyncedSales("invalid")).toBe(true);
    expect(hasLegacyUnsyncedSales('[{"status":"synced"},{"status":"voided"}]')).toBe(false);
  });
  it("only allows explicit refresh from store login", () => {
    expect(isUpdateSafeRoute("/login/store")).toBe(true);
    for (const path of ["/", "/preview/pos", "/offline-pos.html", "/login/user"]) expect(isUpdateSafeRoute(path)).toBe(false);
  });
  it("allows only exact official APK endpoints on the current origin", () => {
    const origin = "https://pos.cuttingpointinnovation.com";
    expect(isTrustedAndroidDownload("/download/android/latest", origin)).toBe(true);
    expect(isTrustedAndroidDownload(origin + "/download/android/modern-latest", origin)).toBe(true);
    for (const target of ["https://example.com/download/android/latest", "//example.com/download/android/latest", "javascript:alert(1)", "/download/android/latest?redirect=https://example.com", "/api/redirect", "https://x@pos.cuttingpointinnovation.com/download/android/latest"]) expect(isTrustedAndroidDownload(target, origin)).toBe(false);
  });
  it("blocks external notification targets in the actual service worker", () => {
    const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    const normalize = runInNewContext(source + "\nsafeSameOriginPath;", {
      self: { location: { origin: "https://pos.cuttingpointinnovation.com", protocol: "https:" }, addEventListener: () => {} }, URL
    }) as (value: unknown) => string;
    expect(normalize("/preview/pos")).toBe("/preview/pos");
    for (const target of ["https://example.com", "//example.com", "intent://evil", "javascript:alert(1)", "https://pos.cuttingpointinnovation.com//example.com", "blob:https://pos.cuttingpointinnovation.com/id", null]) expect(normalize(target)).toBe("/");
  });
  it("does not allow stale HTTP caches to reuse POS session status or logout responses", () => {
    for (const file of ["api/pos/session/current/route.ts", "api/auth/session/context/route.ts", "api/auth/session/logout/route.ts"]) {
      const source = readFileSync(new URL("../../src/app/" + file, import.meta.url), "utf8");
      expect(source).toContain('private, no-store, max-age=0');
    }
  });
  it("requires HTTPS and explicit trusted download interaction in the Android wrapper", () => {
    const source = readFileSync(new URL("../../../pos-android/app/src/main/java/com/cpipos/pos/MainActivity.kt", import.meta.url), "utf8");
    expect(source).toContain('uri.scheme.equals("https", ignoreCase = true)');
    expect(source).toContain("request.hasGesture() && !request.isRedirect");
    expect(source).toContain('notifyPageError(null, "blocked_untrusted_navigation")');
    expect(source).toContain("if (!isOfficialDownloadUri(uri)) return");
    const gate = readFileSync(new URL("../../src/components/android-pos/android-pos-mandatory-update.tsx", import.meta.url), "utf8");
    expect(gate).toContain("href={downloadUrl}");
    expect(gate).not.toContain("window.location.assign(downloadUrl)");
  });
});

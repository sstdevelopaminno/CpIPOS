import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("PWA service worker cache safety", () => {
  it("bumps the shell cache so stale v5 entries are purged", () => {
    expect(sw).toContain('const CACHE_NAME = "cpipos-shell-v6"');
  });

  it("never caches Next.js runtime or RSC navigation payloads", () => {
    expect(sw).toContain('url.pathname.startsWith("/_next/")');
    expect(sw).toContain('url.searchParams.has("_rsc")');
    expect(sw).toContain('request.headers.get("rsc") === "1"');
    expect(sw).toContain('request.headers.has("next-router-state-tree")');
  });

  it("limits cache-first behavior to the explicit offline shell allowlist", () => {
    expect(sw).toContain("const STATIC_SHELL_ASSETS = new Set(ASSETS_TO_CACHE)");
    expect(sw).toContain("if (!STATIC_SHELL_ASSETS.has(url.pathname)) return;");
  });

  it("lets the app decide when an updated worker should skip waiting", () => {
    expect(sw).not.toContain("cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting())");
    expect(sw).toContain('event.data?.type === "SKIP_WAITING"');
  });
});

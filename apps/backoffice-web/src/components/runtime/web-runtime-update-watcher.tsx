"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const VERSION_ENDPOINT = "/api/runtime/version";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RELOAD_MARKER_PREFIX = "cpipos_runtime_reloaded_for_";

type VersionResponse = {
  version?: string;
};

function normalizeVersion(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "local-development";
}

async function fetchRuntimeVersion(signal?: AbortSignal) {
  const response = await fetch(VERSION_ENDPOINT, { cache: "no-store", signal });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as VersionResponse | null;
  return normalizeVersion(body?.version);
}

function canAutoReload(pathname: string) {
  if (pathname.startsWith("/login/")) return true;
  if (pathname === "/login") return true;
  if (pathname.startsWith("/preview/pos") && pathname !== "/preview/pos") return true;
  return false;
}

function markReloaded(version: string) {
  try {
    window.sessionStorage.setItem(`${RELOAD_MARKER_PREFIX}${version}`, "1");
  } catch {
    // Storage may be unavailable in private/device modes; reload protection is best-effort.
  }
}

function wasReloadedFor(version: string) {
  try {
    return window.sessionStorage.getItem(`${RELOAD_MARKER_PREFIX}${version}`) === "1";
  } catch {
    return false;
  }
}

export function WebRuntimeUpdateWatcher() {
  const pathname = usePathname() ?? "/";
  const pathnameRef = useRef(pathname);
  const initialVersionRef = useRef<string | null>(null);
  const checkingRef = useRef(false);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const controller = new AbortController();

    async function checkVersion() {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const nextVersion = await fetchRuntimeVersion(controller.signal);
        if (!nextVersion) return;
        if (!initialVersionRef.current) {
          initialVersionRef.current = nextVersion;
          return;
        }
        if (nextVersion === initialVersionRef.current || wasReloadedFor(nextVersion)) return;

        if (canAutoReload(pathnameRef.current)) {
          markReloaded(nextVersion);
          window.location.reload();
          return;
        }

        setPendingVersion(nextVersion);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Version checks must never disturb POS work.
        }
      } finally {
        checkingRef.current = false;
      }
    }

    const onFocus = () => void checkVersion();
    const onVisibilityChange = () => {
      if (!document.hidden) void checkVersion();
    };

    void checkVersion();
    const interval = window.setInterval(() => {
      if (!document.hidden) void checkVersion();
    }, CHECK_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (!pendingVersion) return null;

  return (
    <aside className="runtime-update-banner" role="status" aria-live="polite">
      <span>{"\u0e21\u0e35\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e23\u0e30\u0e1a\u0e1a\u0e43\u0e2b\u0e21\u0e48"}</span>
      <button
        type="button"
        onClick={() => {
          markReloaded(pendingVersion);
          window.location.reload();
        }}
      >
        {"\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e1e\u0e23\u0e49\u0e2d\u0e21"}
      </button>
    </aside>
  );
}

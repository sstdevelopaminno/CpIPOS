"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PosShiftCycleGuard as PosShiftCycleGuardCore } from "@/components/pos/pos-shift-cycle-guard-core";

type Lang = "th" | "en";

const MAX_CLIENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const CLOCK_RECHECK_INTERVAL_MS = 60 * 1000;

function readServerTimeMs(response: Response) {
  const raw = response.headers.get("date");
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function PosShiftCycleGuard({ lang }: { lang: Lang }) {
  const [mounted, setMounted] = useState(false);
  const [clockSafeForAutomaticShiftClose, setClockSafeForAutomaticShiftClose] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const verifyClock = async () => {
      try {
        const response = await fetch("/api/pos/session/current", { cache: "no-store" });
        const serverTimeMs = readServerTimeMs(response);
        const clockSkewMs = serverTimeMs === null ? Number.POSITIVE_INFINITY : Math.abs(Date.now() - serverTimeMs);
        const isSafe = response.ok && Number.isFinite(clockSkewMs) && clockSkewMs <= MAX_CLIENT_CLOCK_SKEW_MS;

        if (cancelled) return;
        setClockSafeForAutomaticShiftClose(isSafe);

        if (!isSafe) {
          console.warn("[pos-shift-cycle-guard] automatic shift-close guard disabled because client/server clock could not be trusted", {
            hasServerTime: serverTimeMs !== null,
            clockSkewMs: Number.isFinite(clockSkewMs) ? clockSkewMs : null,
            responseStatus: response.status
          });
        }
      } catch (error) {
        if (cancelled) return;
        setClockSafeForAutomaticShiftClose(false);
        console.warn("[pos-shift-cycle-guard] automatic shift-close guard disabled because server time verification failed", {
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    };

    void verifyClock();
    const timer = window.setInterval(() => void verifyClock(), CLOCK_RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!mounted) return null;

  return (
    <>
      <style jsx global>{`
        /* When the entry gate is only asking for an open shift, keep the sales
           content protected but let clicks pass through to the persistent POS
           toolbar. The dialog itself remains interactive. */
        .pos-entry-gate:has(.pos-entry-gate__panel[role="dialog"]) {
          pointer-events: none !important;
        }
        .pos-entry-gate:has(.pos-entry-gate__panel[role="dialog"]) .pos-entry-gate__overlay {
          pointer-events: none !important;
        }
        .pos-entry-gate:has(.pos-entry-gate__panel[role="dialog"]) .pos-entry-gate__panel {
          pointer-events: auto !important;
        }
      `}</style>
      {clockSafeForAutomaticShiftClose
        ? createPortal(<PosShiftCycleGuardCore lang={lang} />, document.body)
        : null}
    </>
  );
}

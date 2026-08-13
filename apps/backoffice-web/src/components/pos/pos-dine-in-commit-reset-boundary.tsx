"use client";

import { useEffect, useRef, useState } from "react";
import { PosEntryGate } from "@/components/pos/pos-entry-gate";

type Lang = "th" | "en";

const DINE_IN_DRAFT_KEY = "pos_dine_in_draft_v001";
const ACTIVE_ORDER_KEY = "pos_active_order_v001";
const SKIP_ENTRY_GATE_SPLASH_KEY = "pos_skip_entry_gate_overlay_once_v1";
const AUTO_SEND_KEY_PREFIX = "pos-dine-kitchen-";

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

function resolveRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const fromInit = String(init?.method ?? "").trim();
  if (fromInit) return fromInit.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function resolveRequestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    const override = new Headers(init.headers);
    override.forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

async function readJsonBody(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    if (typeof init?.body === "string") {
      return JSON.parse(init.body) as Record<string, unknown>;
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      const raw = await input.clone().text();
      if (!raw) return null;
      return JSON.parse(raw) as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function clearCommittedDineInDraft(tableId: string | null) {
  if (!tableId) {
    window.localStorage.removeItem(DINE_IN_DRAFT_KEY);
  } else {
    const raw = window.localStorage.getItem(DINE_IN_DRAFT_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          delete parsed[tableId];
          if (Object.keys(parsed).length > 0) {
            window.localStorage.setItem(DINE_IN_DRAFT_KEY, JSON.stringify(parsed));
          } else {
            window.localStorage.removeItem(DINE_IN_DRAFT_KEY);
          }
        } else {
          window.localStorage.removeItem(DINE_IN_DRAFT_KEY);
        }
      } catch {
        window.localStorage.removeItem(DINE_IN_DRAFT_KEY);
      }
    }
  }

  // Force the remounted POS to rebuild the active order and committed cart baseline
  // from the authoritative table-bill API instead of a stale local snapshot.
  window.localStorage.removeItem(ACTIVE_ORDER_KEY);
  window.sessionStorage.setItem(SKIP_ENTRY_GATE_SPLASH_KEY, "1");
}

export function PosDineInCommitResetBoundary({ lang }: { lang: Lang }) {
  const [epoch, setEpoch] = useState(0);
  const lastResetKeyRef = useRef<string>("");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = resolveRequestUrl(input);
      const method = resolveRequestMethod(input, init);
      const isSalesSubmit = method === "POST" && url?.pathname === "/api/pos/sales";

      if (!isSalesSubmit) {
        return originalFetch(input, init);
      }

      const headers = resolveRequestHeaders(input, init);
      const idempotencyKey = headers.get("x-idempotency-key")?.trim() ?? "";
      const isDineInAutoSend = idempotencyKey.startsWith(AUTO_SEND_KEY_PREFIX);
      if (!isDineInAutoSend) {
        return originalFetch(input, init);
      }

      const body = await readJsonBody(input, init);
      const isDineIn = String(body?.order_type ?? "") === "dine_in";
      if (!isDineIn) {
        return originalFetch(input, init);
      }

      const response = await originalFetch(input, init);
      if (!response.ok || lastResetKeyRef.current === idempotencyKey) {
        return response;
      }

      lastResetKeyRef.current = idempotencyKey;
      const tableId = typeof body?.table_id === "string" && body.table_id.trim() ? body.table_id.trim() : null;
      clearCommittedDineInDraft(tableId);

      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setEpoch((current) => current + 1);
      }, 0);

      return response;
    };

    return () => {
      window.fetch = originalFetch;
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  return <PosEntryGate key={epoch} lang={lang} />;
}

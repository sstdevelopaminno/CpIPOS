"use client";

import { useEffect, useRef, useState } from "react";
import { PosEntryGate } from "@/components/pos/pos-entry-gate";
import { PosInitialSalesModeController } from "@/components/pos/pos-initial-sales-mode-controller";
import { PosSalesModePreferenceEnhancer } from "@/components/pos/pos-sales-mode-preference-enhancer";

type Lang = "th" | "en";

type StoredCartItem = {
  product_id: string;
  quantity: number;
  price: number;
  notes?: string | null;
  [key: string]: unknown;
};

type TableBillItem = {
  product_id: string;
  quantity: number;
  unit_price: number;
  notes?: string | null;
};

type TableBillResponse = {
  data?: {
    items?: TableBillItem[];
  };
};

const DINE_IN_DRAFT_KEY = "pos_dine_in_draft_v001";
const DINE_IN_SELECTED_TABLE_KEY = "pos_dine_in_selected_table_v001";
const ACTIVE_ORDER_KEY = "pos_active_order_v001";
const SKIP_ENTRY_GATE_SPLASH_KEY = "pos_skip_entry_gate_overlay_once_v1";
const KITCHEN_RETURN_MARKER_KEY = "pos_returning_from_kitchen_v1";
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

function buildCartMergeKey(item: { product_id: string; price: number; notes?: string | null }): string {
  return `${item.product_id}:${Number(item.price)}:${item.notes ?? ""}`;
}

function readStoredDraftMap(): Record<string, StoredCartItem[]> | null {
  const raw = window.localStorage.getItem(DINE_IN_DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, StoredCartItem[]>;
  } catch {
    return null;
  }
}

async function reconcileKitchenReturnDraft(): Promise<void> {
  if (window.sessionStorage.getItem(KITCHEN_RETURN_MARKER_KEY) !== "1") return;

  const tableId = window.localStorage.getItem(DINE_IN_SELECTED_TABLE_KEY)?.trim() ?? "";
  const draftMap = readStoredDraftMap();
  const localDraft = tableId && Array.isArray(draftMap?.[tableId]) ? draftMap?.[tableId] ?? [] : [];

  if (!tableId || !draftMap || localDraft.length === 0) {
    window.sessionStorage.removeItem(KITCHEN_RETURN_MARKER_KEY);
    return;
  }

  try {
    const response = await fetch(`/api/pos/tables/${encodeURIComponent(tableId)}/bill?lite=1`, { cache: "no-store" });
    if (!response.ok) return;

    const body = (await response.json().catch(() => null)) as TableBillResponse | null;
    const serverItems = Array.isArray(body?.data?.items) ? body.data.items : [];
    if (serverItems.length === 0) {
      window.sessionStorage.removeItem(KITCHEN_RETURN_MARKER_KEY);
      return;
    }

    const serverQtyByKey = new Map<string, number>();
    for (const item of serverItems) {
      const key = buildCartMergeKey({
        product_id: String(item.product_id ?? ""),
        price: Number(item.unit_price ?? 0),
        notes: item.notes ?? null
      });
      serverQtyByKey.set(key, (serverQtyByKey.get(key) ?? 0) + Number(item.quantity ?? 0));
    }

    const unsentExtras: StoredCartItem[] = [];
    for (const item of localDraft) {
      const key = buildCartMergeKey(item);
      const quantity = Number(item.quantity ?? 0);
      const committedQuantity = serverQtyByKey.get(key) ?? 0;
      const extraQuantity = quantity - committedQuantity;
      if (!Number.isFinite(extraQuantity) || extraQuantity <= 0) continue;
      unsentExtras.push({ ...item, quantity: extraQuantity });
    }

    if (unsentExtras.length > 0) {
      draftMap[tableId] = unsentExtras;
      window.localStorage.setItem(DINE_IN_DRAFT_KEY, JSON.stringify(draftMap));
    } else {
      delete draftMap[tableId];
      if (Object.keys(draftMap).length > 0) {
        window.localStorage.setItem(DINE_IN_DRAFT_KEY, JSON.stringify(draftMap));
      } else {
        window.localStorage.removeItem(DINE_IN_DRAFT_KEY);
      }
    }

    window.sessionStorage.removeItem(KITCHEN_RETURN_MARKER_KEY);
  } catch {
    // Fail safe: keep the original local draft untouched if the authoritative bill cannot be read.
  }
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
  const [entryReady, setEntryReady] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    void reconcileKitchenReturnDraft().finally(() => {
      if (!cancelled) setEntryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!entryReady) return null;
  return (
    <>
      <PosEntryGate key={epoch} lang={lang} />
      <PosSalesModePreferenceEnhancer lang={lang} />
      <PosInitialSalesModeController />
    </>
  );
}

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

type ApiErrorPayload = {
  code?: string;
  error?: {
    code?: string;
  };
};

type CachedTableBillSnapshot = {
  at: number;
  body: string;
};

const DINE_IN_DRAFT_KEY = "pos_dine_in_draft_v001";
const DINE_IN_SELECTED_TABLE_KEY = "pos_dine_in_selected_table_v001";
const ACTIVE_ORDER_KEY = "pos_active_order_v001";
const KITCHEN_RETURN_MARKER_KEY = "pos_returning_from_kitchen_v1";
const AUTO_SEND_KEY_PREFIX = "pos-dine-kitchen-";
const TABLE_BILL_SNAPSHOT_PREFIX = "pos_table_bill_snapshot_v2";
const TABLE_BILL_LITE_MAX_AGE_MS = 30_000;
const TABLE_BILL_FULL_MAX_AGE_MS = 5 * 60_000;
const TABLE_BILL_FAST_RESTORE_WINDOW_MS = 10_000;

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

async function readApiErrorCode(response: Response): Promise<string> {
  try {
    const payload = (await response.clone().json()) as ApiErrorPayload;
    return String(payload?.error?.code ?? payload?.code ?? "").trim();
  } catch {
    return "";
  }
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

function resolveTableBillCacheDescriptor(url: URL): { tableId: string; mode: "lite" | "full"; key: string } | null {
  const match = url.pathname.match(/^\/api\/pos\/tables\/([^/]+)\/bill$/);
  if (!match?.[1]) return null;
  const tableId = decodeURIComponent(match[1]);
  const mode = url.searchParams.get("lite") === "1" ? "lite" : "full";
  return {
    tableId,
    mode,
    key: `${TABLE_BILL_SNAPSHOT_PREFIX}:${tableId}:${mode}`
  };
}

function readTableBillSnapshot(key: string): CachedTableBillSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedTableBillSnapshot>;
    if (!Number.isFinite(parsed.at) || typeof parsed.body !== "string" || !parsed.body) return null;
    return { at: Number(parsed.at), body: parsed.body };
  } catch {
    return null;
  }
}

function writeTableBillSnapshot(key: string, response: Response) {
  if (!response.ok) return;
  void response.clone().text().then((body) => {
    if (!body) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), body } satisfies CachedTableBillSnapshot));
    } catch {
      // Session cache is an acceleration only. Authoritative bill loading remains available.
    }
  }).catch(() => undefined);
}

function cachedTableBillResponse(snapshot: CachedTableBillSnapshot): Response {
  return new Response(snapshot.body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-pos-table-bill-client-cache": "session-warm"
    }
  });
}

function clearTableBillSnapshots(tableId: string | null) {
  if (!tableId) return;
  try {
    window.sessionStorage.removeItem(`${TABLE_BILL_SNAPSHOT_PREFIX}:${tableId}:lite`);
    window.sessionStorage.removeItem(`${TABLE_BILL_SNAPSHOT_PREFIX}:${tableId}:full`);
  } catch {
    // Best effort only.
  }
}

function isQrReviewPoll(url: URL, method: string): boolean {
  return method === "GET" && /^\/api\/pos\/tables\/[^/]+\/qr-orders$/.test(url.pathname);
}

function isQrReviewMutation(url: URL, method: string): boolean {
  return method === "POST" && /^\/api\/pos\/tables\/[^/]+\/qr-orders$/.test(url.pathname);
}

function tableIdFromQrReviewUrl(url: URL): string | null {
  const match = url.pathname.match(/^\/api\/pos\/tables\/([^/]+)\/qr-orders$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function buildPausedQrReviewPollResponse(url: URL): Response {
  // Do not advance the caller cursor while the current review is open. FG0003 will keep
  // the authoritative pending row in the database; this only prevents the same submission
  // from reinitialising acceptedIndexes every poll while staff are ticking choices.
  const cursor = url.searchParams.get("after") || new Date().toISOString();
  return new Response(JSON.stringify({ data: { items: [], server_time: cursor } }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-pos-qr-review-poll": "paused-while-review-open"
    }
  });
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

  // Drop the persisted active-order snapshot after a successful auto-send. The mounted POS
  // keeps its live state, while any later reload rebuilds from the authoritative table-bill API.
  window.localStorage.removeItem(ACTIVE_ORDER_KEY);
  clearTableBillSnapshots(tableId);
}

export function PosDineInCommitResetBoundary({ lang }: { lang: Lang }) {
  const [entryReady, setEntryReady] = useState(false);
  const lastResetKeyRef = useRef<string>("");

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const mountedAt = Date.now();
    const fullRestoreServed = new Set<string>();

    const fetchAndRememberTableBill = async (input: RequestInfo | URL, init: RequestInit | undefined, cacheKey: string) => {
      const response = await originalFetch(input, init);
      writeTableBillSnapshot(cacheKey, response);
      return response;
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = resolveRequestUrl(input);
      const method = resolveRequestMethod(input, init);

      // While staff are reviewing a QR submission, polling the same authoritative pending row
      // must not overwrite the checkbox state back to "all selected" every four seconds.
      if (url && isQrReviewPoll(url, method) && document.querySelector(".posui-payment-modal--review")) {
        return buildPausedQrReviewPollResponse(url);
      }

      if (url && method === "GET") {
        const bill = resolveTableBillCacheDescriptor(url);
        if (bill) {
          const snapshot = readTableBillSnapshot(bill.key);
          const ageMs = snapshot ? Date.now() - snapshot.at : Number.POSITIVE_INFINITY;
          const isLiteWarm = bill.mode === "lite" && ageMs <= TABLE_BILL_LITE_MAX_AGE_MS;
          const isInitialFullRestore =
            bill.mode === "full" &&
            ageMs <= TABLE_BILL_FULL_MAX_AGE_MS &&
            Date.now() - mountedAt <= TABLE_BILL_FAST_RESTORE_WINDOW_MS &&
            !fullRestoreServed.has(bill.tableId);

          if (snapshot && (isLiteWarm || isInitialFullRestore)) {
            if (isInitialFullRestore) fullRestoreServed.add(bill.tableId);
            // Serve the last successful bill immediately, then refresh the snapshot in the
            // background. Normal active-table refreshes go back to the network after this one
            // fast restore, so cached data cannot pin a live table indefinitely.
            void fetchAndRememberTableBill(input, init, bill.key).catch(() => undefined);
            return cachedTableBillResponse(snapshot);
          }

          return fetchAndRememberTableBill(input, init, bill.key);
        }
      }

      const isSalesSubmit = method === "POST" && url?.pathname === "/api/pos/sales";

      if (!isSalesSubmit) {
        const response = await originalFetch(input, init);
        if (url && isQrReviewMutation(url, method) && response.ok) {
          clearTableBillSnapshots(tableIdFromQrReviewUrl(url));
        }
        return response;
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

      let response = await originalFetch(input, init);
      const tableId = typeof body?.table_id === "string" && body.table_id.trim() ? body.table_id.trim() : null;

      if (!response.ok && response.status === 409 && tableId) {
        const errorCode = await readApiErrorCode(response);
        if (errorCode === "table_bill_not_open") {
          const openBillResponse = await originalFetch(`/api/pos/tables/${encodeURIComponent(tableId)}/open-bill`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
            cache: "no-store"
          });
          const openBillCode = openBillResponse.ok ? "" : await readApiErrorCode(openBillResponse);

          if (openBillResponse.ok || openBillCode === "table_already_occupied") {
            const retryBody = { ...(body ?? {}) };
            delete retryBody.order_id;

            // Preserve the table draft, but discard only the stale order snapshot. The server
            // will bind the retried sale to the current bill session and current open shift.
            window.localStorage.removeItem(ACTIVE_ORDER_KEY);

            const retryHeaders = resolveRequestHeaders(input, init);
            if (!retryHeaders.has("content-type")) retryHeaders.set("content-type", "application/json");
            response = await originalFetch(url!.toString(), {
              ...init,
              method: "POST",
              headers: retryHeaders,
              body: JSON.stringify(retryBody),
              cache: "no-store"
            });
          }
        }
      }

      if (!response.ok || lastResetKeyRef.current === idempotencyKey) {
        return response;
      }

      lastResetKeyRef.current = idempotencyKey;
      clearCommittedDineInDraft(tableId);
      return response;
    };

    return () => {
      window.fetch = originalFetch;
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
      <PosEntryGate lang={lang} />
      <PosSalesModePreferenceEnhancer lang={lang} />
      <PosInitialSalesModeController />
    </>
  );
}

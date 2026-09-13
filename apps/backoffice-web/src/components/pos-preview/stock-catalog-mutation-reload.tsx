"use client";

import { useEffect } from "react";

const CATALOG_API_PATH = "/api/backoffice/catalog";
const DELETE_ACTIONS = new Set([
  "deactivate_product",
  "bulk_deactivate_products",
  "delete_ingredient",
  "bulk_delete_ingredients"
]);

function readActionFromBody(body: unknown): string {
  if (typeof body !== "string" || !body.trim()) return "";
  try {
    const parsed = JSON.parse(body) as { action?: unknown } | null;
    return typeof parsed?.action === "string" ? parsed.action : "";
  } catch {
    return "";
  }
}

function shouldWatchRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  if (!url.includes(CATALOG_API_PATH)) return false;
  const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "POST") return false;
  const body = init?.body;
  const action = readActionFromBody(body);
  return DELETE_ACTIONS.has(action);
}

export function StockCatalogMutationReload() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let pendingReload = false;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const watched = shouldWatchRequest(input, init);
      const response = await originalFetch(input, init);
      if (watched && response.ok && !pendingReload) {
        pendingReload = true;
        window.setTimeout(() => {
          window.location.reload();
        }, 250);
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}

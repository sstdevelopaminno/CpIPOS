"use client";

import { useEffect } from "react";

const CART_STORAGE_KEY = "pos_sales_cart_v012";
const TABLE_SELECTOR = "[data-pos-general-sale-cart-table='1']";
const NUDGE_ATTRIBUTE = "data-cpipos-cart-reconcile-nudge";
const NUDGE_DELAYS_MS = [0, 80, 220, 520, 900];

function nudgeGeneralSaleObservers() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const current = root.getAttribute(NUDGE_ATTRIBUTE) === "1" ? "0" : "1";
  root.setAttribute(NUDGE_ATTRIBUTE, current);
  window.dispatchEvent(new CustomEvent("cpipos:pos-cart-mutated", { detail: { source: "general_sale_cart_reconcile_bridge" } }));
}

function scheduleNudges() {
  for (const delay of NUDGE_DELAYS_MS) {
    window.setTimeout(nudgeGeneralSaleObservers, delay);
  }
}

export function PosGeneralSaleCartReconcileBridge() {
  useEffect(() => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
    const originalClear = window.localStorage.clear.bind(window.localStorage);

    window.localStorage.setItem = (key: string, value: string) => {
      originalSetItem(key, value);
      if (key === CART_STORAGE_KEY) scheduleNudges();
    };

    window.localStorage.removeItem = (key: string) => {
      originalRemoveItem(key);
      if (key === CART_STORAGE_KEY) scheduleNudges();
    };

    window.localStorage.clear = () => {
      originalClear();
      scheduleNudges();
    };

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const actionButton = event.target.closest(`${TABLE_SELECTOR} button[data-sd-action][data-sd-index]`);
      if (!actionButton) return;
      scheduleNudges();
    };

    document.addEventListener("click", onClick, true);

    return () => {
      document.removeEventListener("click", onClick, true);
      window.localStorage.setItem = originalSetItem;
      window.localStorage.removeItem = originalRemoveItem;
      window.localStorage.clear = originalClear;
    };
  }, []);

  return null;
}

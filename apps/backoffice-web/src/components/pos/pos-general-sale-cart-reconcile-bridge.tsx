"use client";

import { useEffect } from "react";

const CART_STORAGE_KEY = "pos_sales_cart_v012";
const TABLE_SELECTOR = "[data-pos-general-sale-cart-table='1']";
const CART_MUTATED_EVENT = "cpipos:pos-cart-mutated";
const FALLBACK_EVENT_DELAY_MS = 80;

function emitCartMutated(source: string) {
  window.dispatchEvent(new CustomEvent(CART_MUTATED_EVENT, { detail: { source } }));
}

function notifyCartMutation(source: string) {
  emitCartMutated(source);
  window.setTimeout(() => emitCartMutated(`${source}:settled`), FALLBACK_EVENT_DELAY_MS);
}

export function PosGeneralSaleCartReconcileBridge() {
  useEffect(() => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
    const originalClear = window.localStorage.clear.bind(window.localStorage);

    window.localStorage.setItem = (key: string, value: string) => {
      originalSetItem(key, value);
      if (key === CART_STORAGE_KEY) notifyCartMutation("local_storage_set");
    };

    window.localStorage.removeItem = (key: string) => {
      originalRemoveItem(key);
      if (key === CART_STORAGE_KEY) notifyCartMutation("local_storage_remove");
    };

    window.localStorage.clear = () => {
      originalClear();
      notifyCartMutation("local_storage_clear");
    };

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const actionButton = event.target.closest(`${TABLE_SELECTOR} button[data-sd-action][data-sd-index]`);
      if (!actionButton) return;
      notifyCartMutation("general_sale_table_action");
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

"use client";

import { useEffect } from "react";

const CART_STORAGE_KEY = "pos_sales_cart_v012";
const CART_MUTATED_EVENT = "cpipos:pos-cart-mutated";
const SETTLE_DELAY_MS = 120;

export function PosGeneralSaleCartReconcileBridge() {
  useEffect(() => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
    const originalClear = window.localStorage.clear.bind(window.localStorage);
    let microtaskPending = false;
    let settleTimer: number | null = null;

    const emitCartMutation = () => {
      window.dispatchEvent(
        new CustomEvent(CART_MUTATED_EVENT, {
          detail: { source: "general_sale_cart_reconcile_bridge" }
        })
      );
    };

    const scheduleCartMutation = () => {
      // One leading notification keeps the UI responsive. One trailing notification
      // catches React/localStorage settling. The former bridge fired five delayed
      // nudges plus click nudges for every cart change, which created avoidable churn.
      if (!microtaskPending) {
        microtaskPending = true;
        queueMicrotask(() => {
          microtaskPending = false;
          emitCartMutation();
        });
      }

      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        emitCartMutation();
      }, SETTLE_DELAY_MS);
    };

    window.localStorage.setItem = (key: string, value: string) => {
      originalSetItem(key, value);
      if (key === CART_STORAGE_KEY) scheduleCartMutation();
    };

    window.localStorage.removeItem = (key: string) => {
      originalRemoveItem(key);
      if (key === CART_STORAGE_KEY) scheduleCartMutation();
    };

    window.localStorage.clear = () => {
      originalClear();
      scheduleCartMutation();
    };

    return () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      window.localStorage.setItem = originalSetItem;
      window.localStorage.removeItem = originalRemoveItem;
      window.localStorage.clear = originalClear;
    };
  }, []);

  return null;
}

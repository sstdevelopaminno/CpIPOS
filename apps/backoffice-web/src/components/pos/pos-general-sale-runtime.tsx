"use client";

import { useEffect, useState } from "react";
import { GENERAL_SALE_MODE_ID, GENERAL_SALE_ROOT_ATTRIBUTE } from "@/lib/pos-general-sale-mode";
import { PosGeneralSaleCartReconcileBridge } from "./pos-general-sale-cart-reconcile-bridge";
import { PosGeneralSaleFrontCashPanel } from "./pos-general-sale-front-cash-panel";

function readActive() {
  return document.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE) === GENERAL_SALE_MODE_ID;
}

/**
 * Mount the DOM-heavy general-sale helpers only while grocery/general-sale is active.
 * The old page kept their document-wide observers alive in every sales mode, which
 * made unrelated restaurant/home-mode DOM updates pay the grocery reconciliation cost.
 */
export function PosGeneralSaleRuntime() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let frame: number | null = null;

    const sync = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setActive((current) => {
          const next = readActive();
          return current === next ? current : next;
        });
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [GENERAL_SALE_ROOT_ATTRIBUTE]
    });
    sync();

    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  if (!active) return null;
  return (
    <>
      <PosGeneralSaleCartReconcileBridge />
      <PosGeneralSaleFrontCashPanel />
    </>
  );
}

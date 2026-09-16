"use client";

import { useEffect, useState } from "react";
import { GENERAL_SALE_MODE_ID, GENERAL_SALE_ROOT_ATTRIBUTE } from "@/lib/pos-general-sale-mode";
import { PosGeneralSaleCartReconcileBridge } from "./pos-general-sale-cart-reconcile-bridge";
import { PosGeneralSaleFrontCashPanel } from "./pos-general-sale-front-cash-panel";

function readActive() {
  return document.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE) === GENERAL_SALE_MODE_ID;
}

/**
 * Keep grocery-only cart/cash observers off the main thread in other POS modes.
 * They are mounted as soon as the optimized table controller activates general sale.
 */
export function PosGeneralSaleRuntime() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let frame: number | null = null;

    const sync = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const next = readActive();
        setActive((current) => (current === next ? current : next));
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

"use client";

import { useEffect } from "react";
import {
  GENERAL_SALE_LAYOUT_ATTRIBUTE,
  GENERAL_SALE_LAYOUT_STORAGE_KEY,
  GENERAL_SALE_MODE_ID,
  GENERAL_SALE_ROOT_ATTRIBUTE
} from "@/lib/pos-general-sale-mode";

const STYLE_ID = "cpipos-grocery-table-only-style";
const GRID_BUTTON_QUERY = '[data-sd-layout="grid"]';

function persistTableLayout() {
  try {
    if (window.localStorage.getItem(GENERAL_SALE_LAYOUT_STORAGE_KEY) !== "table") {
      window.localStorage.setItem(GENERAL_SALE_LAYOUT_STORAGE_KEY, "table");
    }
  } catch {
    // Private/hardened WebViews may block storage; the DOM attribute remains authoritative.
  }
}

function enforceTableLayout() {
  persistTableLayout();
  const root = document.documentElement;
  if (
    root.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE) === GENERAL_SALE_MODE_ID &&
    root.getAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE) !== "table"
  ) {
    root.setAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE, "table");
  }
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* Grocery/general-sale is scanner + table only. Do not render the heavy product grid. */
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-category-col,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-topbar-category-slot,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-product-grid-wrap {
      display: none !important;
    }

    .cpipos-sd-layout-switch ${GRID_BUTTON_QUERY} {
      display: none !important;
    }

    .cpipos-sd-layout-switch button[data-sd-layout="table"] {
      pointer-events: none;
      background: #059669 !important;
      color: #fff !important;
    }
  `;
  document.head.appendChild(style);
}

export function PosGroceryTableOnlyGuard() {
  useEffect(() => {
    let disposed = false;
    let frame: number | null = null;

    ensureStyles();
    enforceTableLayout();

    const scheduleEnforce = () => {
      if (disposed || document.hidden || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        enforceTableLayout();
      });
    };

    const observer = new MutationObserver(scheduleEnforce);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [GENERAL_SALE_ROOT_ATTRIBUTE, GENERAL_SALE_LAYOUT_ATTRIBUTE]
    });

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(GRID_BUTTON_QUERY)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      enforceTableLayout();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) scheduleEnforce();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.getElementById(STYLE_ID)?.remove();
    };
  }, []);

  return null;
}

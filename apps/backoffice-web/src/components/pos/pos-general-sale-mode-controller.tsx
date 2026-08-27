"use client";

import { useEffect } from "react";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";
import {
  GENERAL_SALE_CHECKOUT_BASE_MODE,
  GENERAL_SALE_MODE_ID,
  GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE,
  GENERAL_SALE_ROOT_ATTRIBUTE,
  isExactGeneralSaleSkuMatch,
  normalizeGeneralSaleScanCode
} from "@/lib/pos-general-sale-mode";

type Lang = "th" | "en";
type PosFeaturesResponse = {
  data?: {
    features?: Record<string, boolean>;
  } | null;
};

const MODE_SELECTOR_QUERY = ".posui-mode-selector";
const MODE_GRID_QUERY = ".posui-mode-selector__grid";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const MODE_ENHANCED_ATTRIBUTE = "data-pos-mode-preferences-enhanced";
const PRODUCT_GRID_WRAP_QUERY = ".posui-product-grid-wrap";
const GENERAL_SALE_BUTTON_ATTRIBUTE = "data-pos-general-sale-mode-button";
const GENERAL_SALE_SCANNER_ATTRIBUTE = "data-pos-general-sale-scanner";

function resolveLang(): Lang {
  return document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "th";
}

function createTextElement(tag: "span" | "strong" | "small", className: string, text: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function findProductCardBySku(scanCode: string): HTMLButtonElement | null {
  const cards = Array.from(document.querySelectorAll<HTMLButtonElement>(`button[${GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE}]`));
  return cards.find((card) => isExactGeneralSaleSkuMatch(scanCode, card.getAttribute(GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE))) ?? null;
}

function clickAllProductsCategory() {
  const firstCategory = document.querySelector<HTMLButtonElement>(".posui-category-nav .posui-chip--category");
  firstCategory?.click();
}

export function PosGeneralSaleModeController() {
  useEffect(() => {
    let destroyed = false;
    let accessResolved = false;
    let generalSaleAllowed = false;
    let generalSaleActive = false;
    let scannerPanel: HTMLElement | null = null;

    const lang = resolveLang();

    const setRootMode = (active: boolean) => {
      if (active) {
        document.documentElement.setAttribute(GENERAL_SALE_ROOT_ATTRIBUTE, GENERAL_SALE_MODE_ID);
      } else if (document.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE) === GENERAL_SALE_MODE_ID) {
        document.documentElement.removeAttribute(GENERAL_SALE_ROOT_ATTRIBUTE);
      }
    };

    const setModeVisualState = () => {
      const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
      const generalSaleButton = selector?.querySelector<HTMLButtonElement>(`[${GENERAL_SALE_BUTTON_ATTRIBUTE}="1"]`) ?? null;
      const homeButton = selector?.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="${GENERAL_SALE_CHECKOUT_BASE_MODE}"]`) ?? null;
      generalSaleButton?.classList.toggle("is-active", generalSaleActive);
      if (generalSaleActive) homeButton?.classList.remove("is-active");
    };

    const removeScanner = () => {
      scannerPanel?.remove();
      scannerPanel = null;
      document.querySelectorAll<HTMLElement>(`[${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };

    const deactivateGeneralSale = () => {
      generalSaleActive = false;
      setRootMode(false);
      setModeVisualState();
      removeScanner();
    };

    const removeGeneralSaleButton = () => {
      document.querySelectorAll<HTMLElement>(`[${GENERAL_SALE_BUTTON_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };

    const submitScan = async (rawCode: string, status: HTMLElement, input: HTMLInputElement) => {
      const scanCode = normalizeGeneralSaleScanCode(rawCode);
      if (!scanCode) {
        status.textContent = lang === "th" ? "กรุณาสแกนหรือกรอกรหัส SKU/บาร์โค้ด" : "Scan or enter an SKU/barcode.";
        status.dataset.tone = "error";
        input.focus();
        return;
      }

      let card = findProductCardBySku(scanCode);
      if (!card) {
        clickAllProductsCategory();
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
        if (destroyed || !generalSaleActive) return;
        card = findProductCardBySku(scanCode);
      }

      if (!card) {
        status.textContent = lang === "th" ? `ไม่พบสินค้า SKU/บาร์โค้ด: ${scanCode}` : `SKU/barcode not found: ${scanCode}`;
        status.dataset.tone = "error";
        input.select();
        return;
      }

      if (card.disabled) {
        status.textContent = lang === "th" ? `สินค้า ${scanCode} ไม่พร้อมขาย/หมดสต๊อก` : `${scanCode} is unavailable or out of stock.`;
        status.dataset.tone = "error";
        input.select();
        return;
      }

      card.click();
      status.textContent = lang === "th" ? `เพิ่ม ${scanCode} ลงบิลแล้ว` : `Added ${scanCode} to the bill.`;
      status.dataset.tone = "success";
      input.value = "";
      input.focus();
    };

    const ensureScanner = () => {
      if (!generalSaleAllowed || !generalSaleActive) {
        removeScanner();
        return;
      }

      if (scannerPanel?.isConnected) return;
      const existing = document.querySelector<HTMLElement>(`[${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"]`);
      if (existing) {
        scannerPanel = existing;
        return;
      }

      const gridWrap = document.querySelector<HTMLElement>(PRODUCT_GRID_WRAP_QUERY);
      if (!gridWrap?.parentElement) return;

      const panel = document.createElement("section");
      panel.setAttribute(GENERAL_SALE_SCANNER_ATTRIBUTE, "1");
      panel.className = "grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3";
      panel.setAttribute("aria-label", lang === "th" ? "สแกนสินค้าโหมดขายทั่วไป SD" : "SD general sale product scanner");

      const heading = document.createElement("div");
      heading.className = "flex items-center justify-between gap-3";
      heading.append(
        createTextElement("strong", "text-sm font-black text-emerald-950", lang === "th" ? "SD · ขายทั่วไป · สแกน SKU" : "SD · General Sale · SKU scan"),
        createTextElement("small", "text-xs font-bold text-emerald-700", lang === "th" ? "ใช้ระบบชำระเงินมาตรฐานของ POS" : "Uses the standard POS checkout")
      );

      const form = document.createElement("form");
      form.className = "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]";

      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.className = "posui-payment-modal__input";
      input.placeholder = lang === "th" ? "สแกน/กรอก SKU หรือบาร์โค้ด แล้วกด Enter" : "Scan/enter SKU or barcode and press Enter";
      input.setAttribute("aria-label", lang === "th" ? "รหัส SKU หรือบาร์โค้ดสินค้า" : "Product SKU or barcode");

      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "posui-btn posui-btn--primary";
      submit.textContent = lang === "th" ? "เพิ่มสินค้า" : "Add item";

      const status = document.createElement("small");
      status.className = "min-h-4 text-xs font-bold text-slate-600";
      status.setAttribute("aria-live", "polite");

      form.append(input, submit);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitScan(input.value, status, input);
      });

      panel.append(heading, form, status);
      gridWrap.parentElement.insertBefore(panel, gridWrap);
      scannerPanel = panel;
      window.setTimeout(() => input.focus(), 0);
    };

    const enhanceSelector = () => {
      if (!accessResolved || !generalSaleAllowed) {
        deactivateGeneralSale();
        removeGeneralSaleButton();
        return;
      }

      const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
      if (!selector || selector.getAttribute(MODE_ENHANCED_ATTRIBUTE) !== "1") return;
      const grid = selector.querySelector<HTMLElement>(MODE_GRID_QUERY);
      if (!grid) return;

      let generalSaleButton = grid.querySelector<HTMLButtonElement>(`[${GENERAL_SALE_BUTTON_ATTRIBUTE}="1"]`);
      if (!generalSaleButton) {
        generalSaleButton = document.createElement("button");
        generalSaleButton.type = "button";
        generalSaleButton.className = "posui-mode-option";
        generalSaleButton.setAttribute(MODE_ATTRIBUTE, GENERAL_SALE_MODE_ID);
        generalSaleButton.setAttribute(GENERAL_SALE_BUTTON_ATTRIBUTE, "1");
        generalSaleButton.style.order = "99";

        const icon = createTextElement("span", "posui-mode-option__icon", "▦");
        icon.setAttribute("aria-hidden", "true");
        const copy = document.createElement("span");
        copy.className = "posui-mode-option__copy";
        copy.append(
          createTextElement("strong", "", lang === "th" ? "ขายทั่วไป (SD)" : "General Sale (SD)"),
          createTextElement("small", "", lang === "th" ? "สแกน SKU/บาร์โค้ด ตัดสต๊อกสินค้าโดยตรง" : "SKU/barcode fast checkout with direct stock")
        );
        const check = createTextElement("span", "posui-mode-option__check", "✓");
        check.setAttribute("aria-hidden", "true");
        generalSaleButton.append(icon, copy, check);

        generalSaleButton.addEventListener("click", () => {
          if (!generalSaleAllowed) return;
          const homeButton = grid.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="${GENERAL_SALE_CHECKOUT_BASE_MODE}"]`);
          if (!homeButton) return;

          // SD General Sale reuses the proven Home/Takeaway transaction engine.
          // Package/branch access is resolved by /api/pos/features before this button exists.
          homeButton.click();
          generalSaleActive = true;
          setRootMode(true);
          window.setTimeout(() => {
            if (destroyed || !generalSaleActive) return;
            setModeVisualState();
            ensureScanner();
          }, 0);
        });

        grid.appendChild(generalSaleButton);
      }

      setModeVisualState();
    };

    const onModeClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const modeCard = event.target.closest<HTMLElement>(`[${MODE_ATTRIBUTE}]`);
      if (!modeCard) return;
      const mode = modeCard.getAttribute(MODE_ATTRIBUTE);
      if (mode && mode !== GENERAL_SALE_MODE_ID) deactivateGeneralSale();
    };

    const reconcile = () => {
      if (destroyed) return;
      enhanceSelector();
      ensureScanner();
      setModeVisualState();
    };

    async function loadAccess() {
      try {
        const response = await fetch("/api/pos/features", {
          cache: "no-store",
          credentials: "include"
        });
        const body = (await response.json().catch(() => null)) as PosFeaturesResponse | null;
        generalSaleAllowed = Boolean(response.ok && body?.data?.features?.[POS_MODE_FEATURES.general_sale] === true);
      } catch {
        generalSaleAllowed = false;
      } finally {
        accessResolved = true;
        reconcile();
      }
    }

    document.addEventListener("click", onModeClick, true);
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { childList: true, subtree: true });
    void loadAccess();
    reconcile();

    return () => {
      destroyed = true;
      observer.disconnect();
      document.removeEventListener("click", onModeClick, true);
      deactivateGeneralSale();
      removeGeneralSaleButton();
    };
  }, []);

  return null;
}

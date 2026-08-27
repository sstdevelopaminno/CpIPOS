"use client";

import { useEffect } from "react";
import {
  GROCERY_MODE_ID,
  GROCERY_PRODUCT_SKU_ATTRIBUTE,
  GROCERY_ROOT_ATTRIBUTE,
  isExactGrocerySkuMatch,
  normalizeGroceryScanCode
} from "@/lib/pos-grocery-mode";

type Lang = "th" | "en";

const MODE_SELECTOR_QUERY = ".posui-mode-selector";
const MODE_GRID_QUERY = ".posui-mode-selector__grid";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const MODE_ENHANCED_ATTRIBUTE = "data-pos-mode-preferences-enhanced";
const PRODUCT_GRID_WRAP_QUERY = ".posui-product-grid-wrap";
const GROCERY_BUTTON_ATTRIBUTE = "data-pos-grocery-mode-button";
const GROCERY_SCANNER_ATTRIBUTE = "data-pos-grocery-scanner";

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
  const cards = Array.from(document.querySelectorAll<HTMLButtonElement>(`button[${GROCERY_PRODUCT_SKU_ATTRIBUTE}]`));
  return cards.find((card) => isExactGrocerySkuMatch(scanCode, card.getAttribute(GROCERY_PRODUCT_SKU_ATTRIBUTE))) ?? null;
}

function clickAllProductsCategory() {
  const firstCategory = document.querySelector<HTMLButtonElement>(".posui-category-nav .posui-chip--category");
  firstCategory?.click();
}

export function PosGroceryModeController() {
  useEffect(() => {
    let destroyed = false;
    let groceryActive = false;
    let scannerPanel: HTMLElement | null = null;

    const lang = resolveLang();

    const setRootMode = (active: boolean) => {
      if (active) {
        document.documentElement.setAttribute(GROCERY_ROOT_ATTRIBUTE, GROCERY_MODE_ID);
      } else if (document.documentElement.getAttribute(GROCERY_ROOT_ATTRIBUTE) === GROCERY_MODE_ID) {
        document.documentElement.removeAttribute(GROCERY_ROOT_ATTRIBUTE);
      }
    };

    const setModeVisualState = () => {
      const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
      const groceryButton = selector?.querySelector<HTMLButtonElement>(`[${GROCERY_BUTTON_ATTRIBUTE}="1"]`) ?? null;
      const homeButton = selector?.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="home"]`) ?? null;
      groceryButton?.classList.toggle("is-active", groceryActive);
      if (groceryActive) homeButton?.classList.remove("is-active");
    };

    const removeScanner = () => {
      scannerPanel?.remove();
      scannerPanel = null;
      document.querySelectorAll<HTMLElement>(`[${GROCERY_SCANNER_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };

    const deactivateGrocery = () => {
      groceryActive = false;
      setRootMode(false);
      setModeVisualState();
      removeScanner();
    };

    const submitScan = async (rawCode: string, status: HTMLElement, input: HTMLInputElement) => {
      const scanCode = normalizeGroceryScanCode(rawCode);
      if (!scanCode) {
        status.textContent = lang === "th" ? "กรุณาสแกนหรือกรอกรหัส SKU" : "Scan or enter an SKU.";
        status.dataset.tone = "error";
        input.focus();
        return;
      }

      let card = findProductCardBySku(scanCode);
      if (!card) {
        clickAllProductsCategory();
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
        if (destroyed || !groceryActive) return;
        card = findProductCardBySku(scanCode);
      }

      if (!card) {
        status.textContent = lang === "th" ? `ไม่พบสินค้า SKU: ${scanCode}` : `SKU not found: ${scanCode}`;
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
      if (!groceryActive) {
        removeScanner();
        return;
      }

      if (scannerPanel?.isConnected) return;
      const existing = document.querySelector<HTMLElement>(`[${GROCERY_SCANNER_ATTRIBUTE}="1"]`);
      if (existing) {
        scannerPanel = existing;
        return;
      }

      const gridWrap = document.querySelector<HTMLElement>(PRODUCT_GRID_WRAP_QUERY);
      if (!gridWrap?.parentElement) return;

      const panel = document.createElement("section");
      panel.setAttribute(GROCERY_SCANNER_ATTRIBUTE, "1");
      panel.className = "grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3";
      panel.setAttribute("aria-label", lang === "th" ? "สแกนสินค้าโหมดร้านชำ" : "Grocery product scanner");

      const heading = document.createElement("div");
      heading.className = "flex items-center justify-between gap-3";
      heading.append(
        createTextElement("strong", "text-sm font-black text-emerald-950", lang === "th" ? "โหมดร้านชำ · สแกน SKU" : "Grocery · SKU scan"),
        createTextElement("small", "text-xs font-bold text-emerald-700", lang === "th" ? "ใช้ระบบชำระเงินเดิมของ POS" : "Uses the standard POS checkout")
      );

      const form = document.createElement("form");
      form.className = "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]";

      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.className = "posui-payment-modal__input";
      input.placeholder = lang === "th" ? "สแกน/กรอก SKU แล้วกด Enter" : "Scan/enter SKU and press Enter";
      input.setAttribute("aria-label", lang === "th" ? "รหัส SKU สินค้า" : "Product SKU");

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
      const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
      if (!selector || selector.getAttribute(MODE_ENHANCED_ATTRIBUTE) !== "1") return;
      const grid = selector.querySelector<HTMLElement>(MODE_GRID_QUERY);
      if (!grid) return;

      let groceryButton = grid.querySelector<HTMLButtonElement>(`[${GROCERY_BUTTON_ATTRIBUTE}="1"]`);
      if (!groceryButton) {
        groceryButton = document.createElement("button");
        groceryButton.type = "button";
        groceryButton.className = "posui-mode-option";
        groceryButton.setAttribute(MODE_ATTRIBUTE, GROCERY_MODE_ID);
        groceryButton.setAttribute(GROCERY_BUTTON_ATTRIBUTE, "1");
        groceryButton.style.order = "99";

        const icon = createTextElement("span", "posui-mode-option__icon", "▦");
        icon.setAttribute("aria-hidden", "true");
        const copy = document.createElement("span");
        copy.className = "posui-mode-option__copy";
        copy.append(
          createTextElement("strong", "", lang === "th" ? "ร้านชำ" : "Grocery"),
          createTextElement("small", "", lang === "th" ? "สแกน SKU ขายเร็ว ใช้บิลรับกลับ" : "Fast SKU scan using takeaway checkout")
        );
        const check = createTextElement("span", "posui-mode-option__check", "✓");
        check.setAttribute("aria-hidden", "true");
        groceryButton.append(icon, copy, check);

        groceryButton.addEventListener("click", () => {
          const homeButton = grid.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="home"]`);
          if (!homeButton) return;

          // Grocery v1 deliberately reuses the proven Home/Takeaway transaction engine.
          // Activate Home first, then layer the Grocery-specific sales UX on top.
          homeButton.click();
          groceryActive = true;
          setRootMode(true);
          window.setTimeout(() => {
            if (destroyed || !groceryActive) return;
            setModeVisualState();
            ensureScanner();
          }, 0);
        });

        grid.appendChild(groceryButton);
      }

      setModeVisualState();
    };

    const onModeClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const modeCard = event.target.closest<HTMLElement>(`[${MODE_ATTRIBUTE}]`);
      if (!modeCard) return;
      const mode = modeCard.getAttribute(MODE_ATTRIBUTE);
      if (mode && mode !== GROCERY_MODE_ID) deactivateGrocery();
    };

    const reconcile = () => {
      if (destroyed) return;
      enhanceSelector();
      ensureScanner();
      setModeVisualState();
    };

    document.addEventListener("click", onModeClick, true);
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { childList: true, subtree: true });
    reconcile();

    return () => {
      destroyed = true;
      observer.disconnect();
      document.removeEventListener("click", onModeClick, true);
      deactivateGrocery();
      document.querySelectorAll<HTMLElement>(`[${GROCERY_BUTTON_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };
  }, []);

  return null;
}

"use client";

import { useEffect } from "react";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";
import {
  GENERAL_SALE_ADD_PRODUCT_EVENT,
  GENERAL_SALE_ADD_PRODUCT_RESULT_EVENT,
  GENERAL_SALE_CHECKOUT_BASE_MODE,
  GENERAL_SALE_MODE_ID,
  GENERAL_SALE_ROOT_ATTRIBUTE,
  normalizeGeneralSaleScanCode,
  type GeneralSaleAddProductRequest,
  type GeneralSaleAddProductResult,
  type GeneralSaleLookupProduct
} from "@/lib/pos-general-sale-mode";

type Lang = "th" | "en";
type PosFeaturesResponse = {
  data?: {
    features?: Record<string, boolean>;
  } | null;
};

type ProductLookupResponse = {
  data?: {
    product?: GeneralSaleLookupProduct;
  } | null;
  error?: {
    code?: string;
    message?: string;
  } | null;
};

const MODE_SELECTOR_QUERY = ".posui-mode-selector";
const MODE_GRID_QUERY = ".posui-mode-selector__grid";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const MODE_ENHANCED_ATTRIBUTE = "data-pos-mode-preferences-enhanced";
const PRODUCT_GRID_WRAP_QUERY = ".posui-product-grid-wrap";
const GENERAL_SALE_BUTTON_ATTRIBUTE = "data-pos-general-sale-mode-button";
const GENERAL_SALE_SCANNER_ATTRIBUTE = "data-pos-general-sale-scanner";
const CART_BRIDGE_TIMEOUT_MS = 1800;

function resolveLang(): Lang {
  return document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "th";
}

function createTextElement(tag: "span" | "strong" | "small", className: string, text: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `sd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addLookupProductToReactCart(product: GeneralSaleLookupProduct): Promise<GeneralSaleAddProductResult["status"] | "timeout"> {
  return new Promise((resolve) => {
    const requestId = createRequestId();
    let settled = false;

    const finish = (status: GeneralSaleAddProductResult["status"] | "timeout") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener(GENERAL_SALE_ADD_PRODUCT_RESULT_EVENT, onResult as EventListener);
      resolve(status);
    };

    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<GeneralSaleAddProductResult>).detail;
      if (!detail || detail.requestId !== requestId) return;
      finish(detail.status);
    };

    const timeoutId = window.setTimeout(() => finish("timeout"), CART_BRIDGE_TIMEOUT_MS);
    window.addEventListener(GENERAL_SALE_ADD_PRODUCT_RESULT_EVENT, onResult as EventListener);
    const detail: GeneralSaleAddProductRequest = { requestId, product };
    window.dispatchEvent(new CustomEvent<GeneralSaleAddProductRequest>(GENERAL_SALE_ADD_PRODUCT_EVENT, { detail }));
  });
}

export function PosGeneralSaleModeController() {
  useEffect(() => {
    let destroyed = false;
    let accessResolved = false;
    let generalSaleAllowed = false;
    let generalSaleActive = false;
    let scannerPanel: HTMLElement | null = null;
    let scanBusy = false;

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

    const submitScan = async (rawCode: string, status: HTMLElement, input: HTMLInputElement, submit: HTMLButtonElement) => {
      if (scanBusy) return;
      const scanCode = normalizeGeneralSaleScanCode(rawCode);
      if (!scanCode) {
        status.textContent = lang === "th" ? "กรุณาสแกนหรือกรอกรหัส SKU สินค้า" : "Scan or enter a product SKU.";
        status.dataset.tone = "error";
        input.focus();
        return;
      }

      scanBusy = true;
      input.disabled = true;
      submit.disabled = true;
      status.textContent = lang === "th" ? `กำลังค้นหา SKU: ${scanCode}` : `Looking up SKU: ${scanCode}`;
      status.dataset.tone = "pending";

      try {
        const response = await fetch(`/api/pos/products/lookup?sku=${encodeURIComponent(scanCode)}`, {
          cache: "no-store",
          credentials: "include"
        });
        const body = (await response.json().catch(() => null)) as ProductLookupResponse | null;
        if (!response.ok || body?.error || !body?.data?.product) {
          const code = body?.error?.code ?? "product_lookup_failed";
          if (code === "product_not_found") {
            status.textContent = lang === "th" ? `ไม่พบสินค้า SKU: ${scanCode}` : `SKU not found: ${scanCode}`;
          } else if (code === "ambiguous_product_sku") {
            status.textContent = lang === "th" ? `SKU ${scanCode} ซ้ำมากกว่า 1 สินค้า กรุณาแก้รหัสในจัดการสินค้า` : `SKU ${scanCode} matches multiple products. Fix the catalog SKU.`;
          } else {
            status.textContent = body?.error?.message || (lang === "th" ? "ค้นหาสินค้าไม่สำเร็จ กรุณาลองใหม่" : "Product lookup failed. Please retry.");
          }
          status.dataset.tone = "error";
          input.select();
          return;
        }

        const product = body.data.product;
        if (product.is_active === false || product.is_out_of_stock === true) {
          status.textContent = lang === "th" ? `สินค้า ${product.name || scanCode} ไม่พร้อมขาย/หมดสต๊อก` : `${product.name || scanCode} is unavailable or out of stock.`;
          status.dataset.tone = "error";
          input.select();
          return;
        }

        const bridgeStatus = await addLookupProductToReactCart(product);
        if (destroyed || !generalSaleActive) return;
        if (bridgeStatus !== "added") {
          status.textContent =
            bridgeStatus === "unavailable"
              ? lang === "th" ? `สินค้า ${product.name || scanCode} ไม่พร้อมขาย/หมดสต๊อก` : `${product.name || scanCode} is unavailable or out of stock.`
              : lang === "th" ? "ไม่สามารถเชื่อมรายการสินค้าเข้าตะกร้าได้ กรุณาลองใหม่" : "Unable to add the product to the cart. Please retry.";
          status.dataset.tone = "error";
          input.select();
          return;
        }

        status.textContent = lang === "th" ? `เพิ่ม ${product.name} (${scanCode}) ลงตะกร้าแล้ว` : `Added ${product.name} (${scanCode}) to the cart.`;
        status.dataset.tone = "success";
        input.value = "";
      } catch {
        status.textContent = lang === "th" ? "เชื่อมต่อค้นหาสินค้าไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่" : "Product lookup connection failed. Check the network and retry.";
        status.dataset.tone = "error";
        input.select();
      } finally {
        scanBusy = false;
        input.disabled = false;
        submit.disabled = false;
        input.focus();
      }
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
        createTextElement("small", "text-xs font-bold text-emerald-700", lang === "th" ? "ค้นหาจากจัดการสินค้า และใช้ระบบชำระเงินมาตรฐานของ POS" : "Looks up Product Management and uses standard POS checkout")
      );

      const form = document.createElement("form");
      form.className = "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]";

      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.className = "posui-payment-modal__input";
      input.placeholder = lang === "th" ? "ยิงบาร์โค้ด/กรอก SKU แล้วกด Enter" : "Scan barcode / enter SKU and press Enter";
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
        void submitScan(input.value, status, input, submit);
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
          createTextElement("small", "", lang === "th" ? "สแกน SKU ตัดสต๊อกสินค้าโดยตรง" : "SKU fast checkout with direct stock")
        );
        const check = createTextElement("span", "posui-mode-option__check", "✓");
        check.setAttribute("aria-hidden", "true");
        generalSaleButton.append(icon, copy, check);

        generalSaleButton.addEventListener("click", () => {
          if (!generalSaleAllowed) return;
          const homeButton = grid.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="${GENERAL_SALE_CHECKOUT_BASE_MODE}"]`);
          if (!homeButton) return;

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

"use client";

import { useEffect } from "react";
import { GENERAL_SALE_MODE_ID, GENERAL_SALE_ROOT_ATTRIBUTE } from "@/lib/pos-general-sale-mode";

const STYLE_ID = "cpipos-general-sale-front-cash-style";
const PANEL_ATTRIBUTE = "data-pos-general-sale-front-cash";
const DRAFT_READY_ATTRIBUTE = "data-pos-general-sale-cash-draft-ready";
const CASH_DRAFT_STORAGE_KEY = "cpipos_general_sale_cash_draft_v1";
const CASH_MODAL_SYNCED_ATTRIBUTE = "data-pos-general-sale-cash-draft-synced";
const CASH_MODAL_QUERY = ".posui-payment-modal--cash";
const RECEIPT_MODAL_QUERY = ".posui-payment-modal--receipt-final";
const PAYMENT_PANEL_QUERY = ".posui-cart-col .posui-payment-panel";
const CART_STORAGE_KEY = "pos_sales_cart_v012";
const RECONCILE_DELAY_MS = 30;

type Lang = "th" | "en";

type CashDraft = {
  input: string;
  updated_at: string;
};

function resolveLang(): Lang {
  return document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "th";
}

function isGeneralSaleActive(): boolean {
  return document.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE) === GENERAL_SALE_MODE_ID;
}

function formatMoney(value: number): string {
  return `฿${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0)}`;
}

function sanitizeCashInput(value: string): string {
  const cleaned = String(value ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const [wholeRaw = "", ...decimalParts] = cleaned.split(".");
  const wholeDigits = wholeRaw.replace(/^0+(?=\d)/u, "").slice(0, 9) || "0";
  if (decimalParts.length === 0) return wholeDigits;
  const decimalDigits = decimalParts.join("").slice(0, 2);
  return `${wholeDigits}.${decimalDigits}`;
}

function appendCashKey(current: string, key: string): string {
  if (key === "." && current.includes(".")) return current;
  const decimalPart = current.includes(".") ? current.split(".")[1] ?? "" : "";
  if (decimalPart.length >= 2 && key !== ".") return current;
  if (!current) return sanitizeCashInput(key === "." ? "0." : key);
  if (current === "0" && key !== ".") return sanitizeCashInput(key);
  return sanitizeCashInput(`${current}${key}`);
}

function readDraft(): CashDraft {
  try {
    const raw = window.sessionStorage.getItem(CASH_DRAFT_STORAGE_KEY);
    if (!raw) return { input: "", updated_at: new Date(0).toISOString() };
    const parsed = JSON.parse(raw) as Partial<CashDraft> | null;
    return {
      input: sanitizeCashInput(parsed?.input ?? ""),
      updated_at: String(parsed?.updated_at ?? new Date(0).toISOString())
    };
  } catch {
    return { input: "", updated_at: new Date(0).toISOString() };
  }
}

function writeDraft(input: string) {
  const normalized = sanitizeCashInput(input);
  try {
    if (!normalized) {
      window.sessionStorage.removeItem(CASH_DRAFT_STORAGE_KEY);
    } else {
      const draft: CashDraft = { input: normalized, updated_at: new Date().toISOString() };
      window.sessionStorage.setItem(CASH_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    }
  } catch {
    // Session persistence is optional. The current DOM panel remains usable.
  }
  if (normalized) {
    document.documentElement.setAttribute(DRAFT_READY_ATTRIBUTE, "1");
  } else {
    document.documentElement.removeAttribute(DRAFT_READY_ATTRIBUTE);
  }
  window.dispatchEvent(new CustomEvent("cpipos:general-sale-cash-draft-change", { detail: { input: normalized } }));
}

function readCartItemCount(): number {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return 0;
    return parsed.reduce((sum, item) => {
      if (!item || typeof item !== "object") return sum;
      const quantity = Number((item as { quantity?: unknown }).quantity ?? 0);
      return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
    }, 0);
  } catch {
    return 0;
  }
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-cart-col .posui-cart-panel__header { display: none !important; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-cart-col .posui-cart-items,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-cart-col .posui-cart-empty { display: none !important; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-cart-col .posui-cart-panel__body { min-height: 0; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-cart-col .posui-payment-panel { min-height: 0; overflow: auto; }

    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .cpipos-sd-table table { min-width: 1040px; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .cpipos-sd-table__sku {
      width: 190px !important;
      padding-right: 22px !important;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .cpipos-sd-table__category {
      width: 155px !important;
      padding-left: 18px !important;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .cpipos-sd-table__name { min-width: 210px; }

    [${PANEL_ATTRIBUTE}="1"] {
      display: grid;
      gap: 12px;
      margin: 2px 0 12px;
      padding: 12px;
      border: 1px solid #d8e2ef;
      border-radius: 14px;
      background: #fff;
    }
    .cpipos-sd-front-cash__title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 0;
      color: #334155;
      font-size: 12px;
      font-weight: 800;
    }
    .cpipos-sd-front-cash__title strong {
      color: #1d4ed8;
      font-size: 18px;
      font-variant-numeric: tabular-nums;
    }
    .cpipos-sd-front-cash__body {
      display: block;
      min-width: 0;
    }
    .cpipos-sd-front-keypad {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
      width: 100%;
    }
    .cpipos-sd-front-keypad button,
    .cpipos-sd-front-cash__tools button {
      min-height: 42px;
      border: 1px solid #d3deec;
      border-radius: 10px;
      background: #fff;
      color: #172033;
      font: inherit;
      font-weight: 900;
      cursor: pointer;
      touch-action: manipulation;
    }
    .cpipos-sd-front-keypad button { font-size: 18px; }
    .cpipos-sd-front-keypad button:hover,
    .cpipos-sd-front-cash__tools button:hover { background: #f8fafc; }
    .cpipos-sd-front-cash__tools {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
      grid-column: 1 / -1;
    }

    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${DRAFT_READY_ATTRIBUTE}="1"] .posui-payment-modal--cash .posui-cash-keypad,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${DRAFT_READY_ATTRIBUTE}="1"] .posui-payment-modal--cash .posui-cash-quick { display: none !important; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${DRAFT_READY_ATTRIBUTE}="1"] .posui-payment-modal--cash .posui-cash-layout { grid-template-columns: minmax(0, 1fr) !important; }
  `;
  document.head.appendChild(style);
}

function createButton(label: string, action: () => void, className = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", action);
  return button;
}

function normalizeDraftForKeypad(input: string): string[] {
  const normalized = sanitizeCashInput(input);
  if (!normalized) return [];
  return Array.from(normalized);
}

export function PosGeneralSaleFrontCashPanel() {
  useEffect(() => {
    let disposed = false;
    let reconcileTimer: number | null = null;
    let lastPanelSignature = "";
    let previousGeneralSaleActive = false;
    let previousCartItemCount = readCartItemCount();
    const syncingCashModals = new WeakSet<HTMLElement>();
    const syncedCashModals = new WeakSet<HTMLElement>();

    ensureStyles();
    const initialDraft = readDraft();
    if (initialDraft.input) document.documentElement.setAttribute(DRAFT_READY_ATTRIBUTE, "1");

    const removePanel = () => {
      document.querySelectorAll<HTMLElement>(`[${PANEL_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
      lastPanelSignature = "";
    };

    const updateDraft = (nextInput: string) => {
      writeDraft(nextInput);
      lastPanelSignature = "";
      renderPanel();
    };

    const renderPanel = () => {
      if (disposed || !isGeneralSaleActive()) {
        removePanel();
        return;
      }
      const paymentPanel = document.querySelector<HTMLElement>(PAYMENT_PANEL_QUERY);
      if (!paymentPanel) return;

      const draft = readDraft();
      const received = Math.max(0, Number(draft.input || 0));
      const safeReceived = Number.isFinite(received) ? received : 0;
      const signature = `${draft.input}:${resolveLang()}`;
      let host = paymentPanel.querySelector<HTMLElement>(`:scope > [${PANEL_ATTRIBUTE}="1"]`);
      if (host && signature === lastPanelSignature) return;
      lastPanelSignature = signature;

      if (!host) {
        host = document.createElement("section");
        host.setAttribute(PANEL_ATTRIBUTE, "1");
        const actions = paymentPanel.querySelector<HTMLElement>(".posui-bill-actions");
        if (actions) paymentPanel.insertBefore(host, actions);
        else paymentPanel.appendChild(host);
      }

      const lang = resolveLang();
      const title = document.createElement("p");
      title.className = "cpipos-sd-front-cash__title";
      const titleText = document.createElement("span");
      titleText.textContent = lang === "th" ? "แป้นตัวเลข" : "Keypad";
      const amountState = document.createElement("strong");
      amountState.textContent = draft.input ? formatMoney(safeReceived) : formatMoney(0);
      title.append(titleText, amountState);

      const body = document.createElement("div");
      body.className = "cpipos-sd-front-cash__body";

      const keypad = document.createElement("div");
      keypad.className = "cpipos-sd-front-keypad";
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00", "."].forEach((key) => {
        keypad.appendChild(createButton(key, () => updateDraft(appendCashKey(readDraft().input, key))));
      });
      const tools = document.createElement("div");
      tools.className = "cpipos-sd-front-cash__tools";
      tools.append(
        createButton(lang === "th" ? "ล้าง" : "Clear", () => updateDraft("")),
        createButton(lang === "th" ? "ลบ" : "Delete", () => updateDraft(readDraft().input.slice(0, -1)))
      );
      keypad.appendChild(tools);

      body.appendChild(keypad);
      host.replaceChildren(title, body);
    };

    const syncDraftIntoCashModal = (cashModal: HTMLElement) => {
      if (!isGeneralSaleActive() || syncedCashModals.has(cashModal) || syncingCashModals.has(cashModal)) return;
      const draft = readDraft();
      const tokens = normalizeDraftForKeypad(draft.input);
      if (tokens.length === 0) return;
      syncingCashModals.add(cashModal);

      let index = 0;
      const pressNext = () => {
        if (disposed || !cashModal.isConnected || !isGeneralSaleActive()) {
          syncingCashModals.delete(cashModal);
          return;
        }
        const token = tokens[index];
        if (token === undefined) {
          syncingCashModals.delete(cashModal);
          syncedCashModals.add(cashModal);
          cashModal.setAttribute(CASH_MODAL_SYNCED_ATTRIBUTE, "1");
          return;
        }
        const keyButton = Array.from(cashModal.querySelectorAll<HTMLButtonElement>(".posui-cash-keypad__key"))
          .find((button) => button.textContent?.trim() === token);
        if (!keyButton) {
          syncingCashModals.delete(cashModal);
          return;
        }
        keyButton.click();
        index += 1;
        window.setTimeout(pressNext, 36);
      };
      pressNext();
    };

    const inspectPaymentModal = () => {
      const cashModal = document.querySelector<HTMLElement>(CASH_MODAL_QUERY);
      if (cashModal) syncDraftIntoCashModal(cashModal);
      if (document.querySelector(RECEIPT_MODAL_QUERY) && readDraft().input) {
        writeDraft("");
        lastPanelSignature = "";
      }
    };

    const reconcile = () => {
      reconcileTimer = null;
      if (disposed) return;
      const active = isGeneralSaleActive();
      const cartItemCount = readCartItemCount();

      if (previousGeneralSaleActive && !active) {
        writeDraft("");
        removePanel();
      }
      if (active && previousCartItemCount === 0 && cartItemCount > 0 && document.querySelector(RECEIPT_MODAL_QUERY)) {
        writeDraft("");
      }
      previousGeneralSaleActive = active;
      previousCartItemCount = cartItemCount;

      if (active) renderPanel();
      else removePanel();
      inspectPaymentModal();
    };

    const scheduleReconcile = () => {
      if (reconcileTimer !== null) window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(reconcile, RECONCILE_DELAY_MS);
    };

    const observer = new MutationObserver(scheduleReconcile);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) scheduleReconcile();
    };
    const onDraftChange = () => scheduleReconcile();
    window.addEventListener("storage", onStorage);
    window.addEventListener("cpipos:general-sale-cash-draft-change", onDraftChange);
    scheduleReconcile();

    return () => {
      disposed = true;
      observer.disconnect();
      if (reconcileTimer !== null) window.clearTimeout(reconcileTimer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cpipos:general-sale-cash-draft-change", onDraftChange);
      removePanel();
      document.documentElement.removeAttribute(DRAFT_READY_ATTRIBUTE);
      document.getElementById(STYLE_ID)?.remove();
    };
  }, []);

  return null;
}

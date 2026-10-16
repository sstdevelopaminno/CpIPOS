"use client";

import { useEffect } from "react";
import { formatSalesMoney, normalizeSalesCurrency } from "@/lib/pos-money";
import { generalSaleUi, type GeneralSaleLanguage } from "@/lib/pos-general-sale-i18n";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";
import { isAuthorizedOpticalRetailMode } from "@/lib/pos-sales-modes";
import {
  buildGeneralSaleCartTableRows,
  buildGeneralSaleCartTableSignature,
  parseGeneralSaleCartStorage,
  parseGeneralSaleSalesSnapshot
} from "@/lib/pos-general-sale-cart-table";
import {
  GENERAL_SALE_ADD_PRODUCT_EVENT,
  GENERAL_SALE_ADD_PRODUCT_RESULT_EVENT,
  GENERAL_SALE_CHECKOUT_BASE_MODE,
  GENERAL_SALE_ACTIVATE_BASE_MODE_EVENT,
  OPTICAL_ACTIVATE_BASE_MODE_EVENT,
  OPTICAL_DEACTIVATE_BASE_MODE_EVENT,
  OPTICAL_ACTIVE_ROOT_ATTRIBUTE,
  POS_STARTUP_MODE_REQUEST_EVENT,
  POS_STARTUP_MODE_RESULT_EVENT,
  type PosStartupModeRequest,
  type PosStartupModeResult,
  GENERAL_SALE_LAYOUT_ATTRIBUTE,
  GENERAL_SALE_LAYOUT_STORAGE_KEY,
  GENERAL_SALE_MODE_ID,
  GENERAL_SALE_ROOT_ATTRIBUTE,
  normalizeGeneralSaleScanCode,
  type GeneralSaleAddProductRequest,
  type GeneralSaleAddProductResult,
  type GeneralSaleLookupProduct
} from "@/lib/pos-general-sale-mode";

type Lang = GeneralSaleLanguage;
type PosFeaturesResponse = {
  data?: {
    features?: Record<string, boolean>;
    sales_modes?: { general_sale?: boolean; optical_retail?: boolean };
    is_custom?: boolean;
    is_internal_test_full?: boolean;
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
const MODE_SWITCH_BUTTON_QUERY = ".posui-mode-switch-button";
const OPTICAL_HANDLER_READY_ATTRIBUTE = "data-pos-optical-handler-ready";
const MODE_GRID_QUERY = ".posui-mode-selector__grid";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const MODE_ENHANCED_ATTRIBUTE = "data-pos-mode-preferences-enhanced";
const PRODUCT_GRID_WRAP_QUERY = ".posui-product-grid-wrap";
const GENERAL_SALE_BUTTON_ATTRIBUTE = "data-pos-general-sale-mode-button";
const OPTICAL_BUTTON_ATTRIBUTE = "data-pos-optical-retail-mode-button";
const OPTICAL_MODE_ID = "optical_retail";
const GENERAL_SALE_SCANNER_ATTRIBUTE = "data-pos-general-sale-scanner";
const GENERAL_SALE_TABLE_ATTRIBUTE = "data-pos-general-sale-cart-table";
const GENERAL_SALE_STYLE_ID = "cpipos-general-sale-table-only-style";
const POS_TAKEAWAY_CART_STORAGE_KEY = "pos_sales_cart_v012";
const POS_SALES_SNAPSHOT_STORAGE_KEY = "pos_sales_snapshot_v001";
const CART_MUTATED_EVENT = "cpipos:pos-cart-mutated";
const CART_BRIDGE_TIMEOUT_MS = 1800;
const CART_RENDER_DELAY_MS = 48;
const MAX_QUEUED_SCANS = 25;
const OPTICAL_SCAN_IDLE_MS = 140;
const OPTICAL_MANUAL_IDLE_MS = 480;
const OPTICAL_SCAN_KEY_INTERVAL_MS = 85;
const PRODUCT_LOOKUP_TIMEOUT_MS = 5200;


function createTextElement(tag: "p" | "span" | "strong" | "small", className: string, text: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `sd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatMoney(value: number): string {
  return formatSalesMoney(value, normalizeSalesCurrency(
    document.documentElement.getAttribute("data-pos-store-currency")
  ));
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

function ensureGeneralSaleStyles() {
  if (document.getElementById(GENERAL_SALE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = GENERAL_SALE_STYLE_ID;
  style.textContent = `
    [${GENERAL_SALE_TABLE_ATTRIBUTE}="1"] { display: none; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-category-col,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-topbar-category-slot,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] ${PRODUCT_GRID_WRAP_QUERY} { display: none !important; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-cart-col .posui-cart-items,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] .posui-cart-col .posui-cart-empty { display: none !important; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"] [${GENERAL_SALE_TABLE_ATTRIBUTE}="1"] { display: grid; }
    .cpipos-sd-table-mode { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid #a7f3d0; border-radius: 10px; background: #ecfdf5; color: #065f46; font-size: 12px; font-weight: 900; white-space: nowrap; }
    .cpipos-sd-table { min-width: 0; gap: 10px; border: 1px solid #dbe7e3; border-radius: 14px; background: #fff; overflow: hidden; }
    .cpipos-sd-table__summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: #f0fdf4; border-bottom: 1px solid #d1fae5; }
    .cpipos-sd-table__summary p { margin: 0; color: #065f46; font-size: 13px; font-weight: 800; }
    .cpipos-sd-table__summary strong { color: #ea580c; font-size: 18px; font-weight: 900; }
    .cpipos-sd-table__scroll { width: 100%; overflow: auto; max-height: min(58vh, 620px); overscroll-behavior: contain; }
    .cpipos-sd-table table { width: 100%; min-width: 900px; border-collapse: collapse; table-layout: fixed; }
    .cpipos-sd-table th { position: sticky; top: 0; z-index: 1; padding: 10px 8px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px; font-weight: 900; text-align: left; }
    .cpipos-sd-table td { padding: 10px 8px; border-bottom: 1px solid #eef2f7; color: #0f172a; font-size: 13px; vertical-align: middle; }
    .cpipos-sd-table tbody tr:last-child td { border-bottom: 0; }
    .cpipos-sd-table__index { width: 50px; text-align: center !important; }
    .cpipos-sd-table__sku { width: 135px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 800; }
    .cpipos-sd-table__category { width: 135px; }
    .cpipos-sd-table__name { width: auto; min-width: 220px; font-weight: 800; }
    .cpipos-sd-table__name small { display: block; margin-top: 3px; color: #64748b; font-weight: 600; }
    .cpipos-sd-table__qty { width: 150px; }
    .cpipos-sd-table__money { width: 125px; text-align: right !important; font-variant-numeric: tabular-nums; }
    .cpipos-sd-table__actions { width: 70px; text-align: center !important; }
    .cpipos-sd-qty { display: inline-grid; grid-template-columns: 34px minmax(42px, auto) 34px; align-items: center; border: 1px solid #cbd5e1; border-radius: 9px; overflow: hidden; background: #fff; }
    .cpipos-sd-qty button { width: 34px; height: 32px; border: 0; background: #f8fafc; color: #0f172a; font-size: 18px; font-weight: 900; cursor: pointer; }
    .cpipos-sd-qty span { padding: 0 8px; text-align: center; font-weight: 900; font-variant-numeric: tabular-nums; }
    .cpipos-sd-delete { width: 34px; height: 32px; border: 1px solid #fecaca; border-radius: 8px; background: #fff7f7; color: #dc2626; font-weight: 900; cursor: pointer; }
    .cpipos-sd-table__empty { padding: 54px 20px; color: #64748b; font-size: 14px; font-weight: 800; text-align: center; }
    [${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"] [data-tone="error"] { color: #dc2626; }
    [${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"] [data-tone="success"] { color: #047857; }
    [${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"] [data-tone="pending"] { color: #0369a1; }
    @media (max-width: 900px) {
      .cpipos-sd-table__summary { align-items: flex-start; flex-direction: column; }
    }
  `;
  document.head.appendChild(style);
}

export function PosGeneralSaleTableController({ lang = "th" }: { lang?: Lang }) {
  useEffect(() => {
    let destroyed = false;
    let accessResolved = false;
    let accessSequence = 0;
    let latestSelector: HTMLElement | null = null;
    let generalSaleAllowed = false;
    let opticalAllowed = false;
    let generalSaleActive = false;
    let opticalActive = false;
    let pendingStartupMode: PosStartupModeRequest | null = null;
    let processingStartupRequestId: string | null = null;
    let pendingStartupRetryCount = 0;
    let pendingStartupRetryTimer: number | null = null;
    let scannerPanel: HTMLElement | null = null;
    let scannerInput: HTMLInputElement | null = null;
    let scannerSubmit: HTMLButtonElement | null = null;
    let scannerStatus: HTMLElement | null = null;
    let tableHost: HTMLElement | null = null;
    let tableRenderTimer: number | null = null;
    let reconcileFrame: number | null = null;
    let lastTableSignature = "";
    let scanBusy = false;
    let opticalAutoScanTimer: number | null = null;
    let opticalBillScanTimer: number | null = null;
    let opticalLastKeyAt = 0;
    let opticalFastKeyCount = 0;
    const scanQueue: string[] = [];
    const lookupProductsById = new Map<string, GeneralSaleLookupProduct>();
    const copy = generalSaleUi[lang];

    ensureGeneralSaleStyles();
    try {
      window.localStorage.setItem(GENERAL_SALE_LAYOUT_STORAGE_KEY, "table");
    } catch {
      // Layout persistence is optional.
    }

    const setRootMode = (active: boolean) => {
      if (active) {
        document.documentElement.setAttribute(GENERAL_SALE_ROOT_ATTRIBUTE, GENERAL_SALE_MODE_ID);
        document.documentElement.setAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE, "table");
        if (opticalActive) document.documentElement.setAttribute(OPTICAL_ACTIVE_ROOT_ATTRIBUTE, "1");
        else document.documentElement.removeAttribute(OPTICAL_ACTIVE_ROOT_ATTRIBUTE);
      } else {
        if (document.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE) === GENERAL_SALE_MODE_ID) {
          document.documentElement.removeAttribute(GENERAL_SALE_ROOT_ATTRIBUTE);
        }
        document.documentElement.removeAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE);
        document.documentElement.removeAttribute(OPTICAL_ACTIVE_ROOT_ATTRIBUTE);
      }
    };

    const setModeVisualState = () => {
      const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
      const generalSaleButton = selector?.querySelector<HTMLButtonElement>(`[${GENERAL_SALE_BUTTON_ATTRIBUTE}="1"]`) ?? null;
      const opticalButton = selector?.querySelector<HTMLButtonElement>(`[${OPTICAL_BUTTON_ATTRIBUTE}="1"]`) ?? null;
      opticalButton?.classList.toggle("is-active", generalSaleActive && opticalActive);
      const homeButton = selector?.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="${GENERAL_SALE_CHECKOUT_BASE_MODE}"]`) ?? null;
      generalSaleButton?.classList.toggle("is-active", generalSaleActive && !opticalActive);
      if (generalSaleActive) homeButton?.classList.remove("is-active");
    };

    const removeTable = () => {
      if (tableRenderTimer !== null) {
        window.clearTimeout(tableRenderTimer);
        tableRenderTimer = null;
      }
      tableHost?.remove();
      tableHost = null;
      lastTableSignature = "";
      document.querySelectorAll<HTMLElement>(`[${GENERAL_SALE_TABLE_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };

    const removeScanner = () => {
      if (opticalAutoScanTimer !== null) {
        window.clearTimeout(opticalAutoScanTimer);
        opticalAutoScanTimer = null;
      }
      opticalFastKeyCount = 0;
      if (opticalBillScanTimer !== null) {
        window.clearTimeout(opticalBillScanTimer);
        opticalBillScanTimer = null;
      }
      scannerPanel?.remove();
      scannerPanel = null;
      scannerInput = null;
      scannerSubmit = null;
      scannerStatus = null;
      document.querySelectorAll<HTMLElement>(`[${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };

    const deactivateGeneralSale = () => {
      if (opticalActive) {
        window.dispatchEvent(new Event(OPTICAL_DEACTIVATE_BASE_MODE_EVENT));
      }
      generalSaleActive = false;
      opticalActive = false;
      setRootMode(false);
      setModeVisualState();
      removeTable();
      removeScanner();
    };

    const removeGeneralSaleButton = () => {
      document.querySelectorAll<HTMLElement>(`[${GENERAL_SALE_BUTTON_ATTRIBUTE}="1"], [${OPTICAL_BUTTON_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };

    const ensureTableHost = () => {
      if ((!generalSaleAllowed && !opticalAllowed) || !generalSaleActive) {
        removeTable();
        return null;
      }
      if (tableHost?.isConnected) return tableHost;
      const existing = document.querySelector<HTMLElement>(`[${GENERAL_SALE_TABLE_ATTRIBUTE}="1"]`);
      if (existing) {
        tableHost = existing;
        return tableHost;
      }
      const gridWrap = document.querySelector<HTMLElement>(PRODUCT_GRID_WRAP_QUERY);
      if (!gridWrap?.parentElement) return null;
      const host = document.createElement("section");
      host.setAttribute(GENERAL_SALE_TABLE_ATTRIBUTE, "1");
      host.className = "cpipos-sd-table";
      host.setAttribute("aria-label", copy.tableAria);
      gridWrap.parentElement.insertBefore(host, gridWrap);
      tableHost = host;
      return host;
    };

    const invokeCartAction = (rowIndex: number, action: "decrease" | "increase" | "delete") => {
      const cartNodes = Array.from(document.querySelectorAll<HTMLElement>(".posui-cart-col .posui-cart-item"));
      const cartNode = cartNodes[rowIndex];
      if (!cartNode) return;
      let target: HTMLButtonElement | null = null;
      if (action === "decrease") target = cartNode.querySelector<HTMLButtonElement>('.posui-qty-row button[aria-label^="Decrease "]');
      if (action === "increase") target = cartNode.querySelector<HTMLButtonElement>('.posui-qty-row button[aria-label^="Increase "]');
      if (action === "delete") target = cartNode.querySelector<HTMLButtonElement>(".posui-cart-action--delete");
      target?.click();
    };

    const renderTable = () => {
      tableRenderTimer = null;
      if (destroyed || !generalSaleActive) return;
      const host = ensureTableHost();
      if (!host) return;

      let cartText: string | null = null;
      let snapshotText: string | null = null;
      try {
        cartText = window.localStorage.getItem(POS_TAKEAWAY_CART_STORAGE_KEY);
        snapshotText = window.localStorage.getItem(POS_SALES_SNAPSHOT_STORAGE_KEY);
      } catch {
        // Storage can be unavailable in hardened/private WebViews.
      }

      const rows = buildGeneralSaleCartTableRows({
        cart: parseGeneralSaleCartStorage(cartText),
        snapshotProducts: parseGeneralSaleSalesSnapshot(snapshotText),
        lookupProducts: lookupProductsById.values()
      });
      // A late server-approved currency response must re-render the same cart
      // rather than leaving its previous THB formatted amount on screen.
      const signature = `${lang}:${document.documentElement.getAttribute("data-pos-store-currency") ?? "THB"}:${buildGeneralSaleCartTableSignature(rows)}`;
      if (signature === lastTableSignature && host.childElementCount > 0) return;
      lastTableSignature = signature;

      const summary = document.createElement("header");
      summary.className = "cpipos-sd-table__summary";
      const count = rows.reduce((sum, row) => sum + row.quantity, 0);
      const total = rows.reduce((sum, row) => sum + row.lineTotal, 0);
      summary.append(
        createTextElement("p", "", `${copy.tableTitle} · ${count} ${copy.units} · ${rows.length} ${copy.lines}`),
        createTextElement("strong", "", formatMoney(total))
      );

      const scroll = document.createElement("div");
      scroll.className = "cpipos-sd-table__scroll";
      if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "cpipos-sd-table__empty";
        empty.textContent = copy.empty;
        scroll.appendChild(empty);
      } else {
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        const headers = copy.headers;
        const classes = ["cpipos-sd-table__index", "cpipos-sd-table__sku", "cpipos-sd-table__category", "cpipos-sd-table__name", "cpipos-sd-table__qty", "cpipos-sd-table__money", "cpipos-sd-table__money", "cpipos-sd-table__actions"];
        headers.forEach((label, index) => {
          const th = document.createElement("th");
          th.className = classes[index];
          th.textContent = label;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);

        const tbody = document.createElement("tbody");
        rows.forEach((row, index) => {
          const tr = document.createElement("tr");
          const indexCell = document.createElement("td");
          indexCell.className = "cpipos-sd-table__index";
          indexCell.textContent = String(index + 1);
          const skuCell = document.createElement("td");
          skuCell.className = "cpipos-sd-table__sku";
          skuCell.textContent = row.sku;
          const categoryCell = document.createElement("td");
          categoryCell.className = "cpipos-sd-table__category";
          categoryCell.textContent = row.category;
          const nameCell = document.createElement("td");
          nameCell.className = "cpipos-sd-table__name";
          nameCell.appendChild(createTextElement("strong", "", row.name));
          if (row.notes) nameCell.appendChild(createTextElement("small", "", row.notes));
          const qtyCell = document.createElement("td");
          qtyCell.className = "cpipos-sd-table__qty";
          const qty = document.createElement("div");
          qty.className = "cpipos-sd-qty";
          const decrease = document.createElement("button");
          decrease.type = "button";
          decrease.textContent = "−";
          decrease.dataset.sdAction = "decrease";
          decrease.dataset.sdIndex = String(index);
          decrease.setAttribute("aria-label", `${copy.decrease} ${row.name}`);
          const qtyValue = createTextElement("span", "", String(row.quantity));
          const increase = document.createElement("button");
          increase.type = "button";
          increase.textContent = "+";
          increase.dataset.sdAction = "increase";
          increase.dataset.sdIndex = String(index);
          increase.setAttribute("aria-label", `${copy.increase} ${row.name}`);
          qty.append(decrease, qtyValue, increase);
          qtyCell.appendChild(qty);
          const unitPriceCell = document.createElement("td");
          unitPriceCell.className = "cpipos-sd-table__money";
          unitPriceCell.textContent = formatMoney(row.unitPrice);
          const totalCell = document.createElement("td");
          totalCell.className = "cpipos-sd-table__money";
          totalCell.textContent = formatMoney(row.lineTotal);
          const actionCell = document.createElement("td");
          actionCell.className = "cpipos-sd-table__actions";
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "cpipos-sd-delete";
          remove.textContent = "×";
          remove.dataset.sdAction = "delete";
          remove.dataset.sdIndex = String(index);
          remove.setAttribute("aria-label", `${copy.remove} ${row.name}`);
          actionCell.appendChild(remove);
          tr.append(indexCell, skuCell, categoryCell, nameCell, qtyCell, unitPriceCell, totalCell, actionCell);
          tbody.appendChild(tr);
        });
        table.append(thead, tbody);
        scroll.appendChild(table);
      }
      host.replaceChildren(summary, scroll);
    };

    const scheduleTableRender = (delayMs = CART_RENDER_DELAY_MS) => {
      if (!generalSaleActive) return;
      if (pendingStartupRetryTimer !== null) window.clearTimeout(pendingStartupRetryTimer);
      if (tableRenderTimer !== null) window.clearTimeout(tableRenderTimer);
      tableRenderTimer = window.setTimeout(renderTable, delayMs);
    };

    const submitScan = async (rawCode: string, status: HTMLElement, input: HTMLInputElement, submit: HTMLButtonElement) => {
      const originalSku = rawCode.trim();
      const scanCode = normalizeGeneralSaleScanCode(originalSku);
      if (!scanCode) {
        status.textContent = copy.missingSku;
        status.dataset.tone = "error";
        input.focus();
        return;
      }
      input.value = "";
      if (scanBusy) {
        if (scanQueue.length >= MAX_QUEUED_SCANS) {
          status.textContent = copy.queueFull;
          status.dataset.tone = "error";
          return;
        }
        scanQueue.push(opticalActive ? originalSku : scanCode);
        status.textContent = lang === "lo" ? `ເພີ່ມ ${scanCode} ເຂົ້າຄິວແລ້ວ · ລໍຖ້າ ${scanQueue.length} ລາຍການ` : lang === "th" ? `รับรหัส ${scanCode} เข้าคิวแล้ว · รอ ${scanQueue.length} รายการ` : `Queued ${scanCode} · ${scanQueue.length} waiting`;
        status.dataset.tone = "pending";
        return;
      }

      scanBusy = true;
      submit.disabled = true;
      submit.textContent = copy.adding;
      status.textContent = lang === "lo" ? `ກຳລັງຄົ້ນຫາ SKU: ${scanCode}` : lang === "th" ? `กำลังค้นหา SKU: ${scanCode}` : `Looking up SKU: ${scanCode}`;
      status.dataset.tone = "pending";
      const controller = new AbortController();
      const lookupTimeout = opticalActive
        ? window.setTimeout(() => controller.abort(), PRODUCT_LOOKUP_TIMEOUT_MS)
        : null;
      try {
        // One exact SKU lookup per completed scan; never on each keystroke.
        const response = await fetch(`/api/pos/products/lookup?sku=${encodeURIComponent(opticalActive ? originalSku : scanCode)}`, {
          cache: "no-store",
          credentials: "include",
          ...(opticalActive ? { signal: controller.signal } : {})
        });
        const body = (await response.json().catch(() => null)) as ProductLookupResponse | null;
        if (!response.ok || body?.error || !body?.data?.product) {
          const code = body?.error?.code ?? "product_lookup_failed";
          status.textContent = code === "product_not_found"
            ? (lang === "lo" ? `ບໍ່ພົບສິນຄ້າ SKU: ${scanCode}` : lang === "th" ? `ไม่พบสินค้า SKU: ${scanCode}` : `SKU not found: ${scanCode}`)
            : body?.error?.message || (copy.lookupFailed);
          status.dataset.tone = "error";
          return;
        }
        const product = body.data.product;
        lookupProductsById.set(product.id, product);
        if (product.is_active === false || product.is_out_of_stock === true) {
          status.textContent = lang === "lo" ? `ສິນຄ້າ ${product.name || scanCode} ບໍ່ພ້ອມຂາຍ/ໝົດສະຕັອກ` : lang === "th" ? `สินค้า ${product.name || scanCode} ไม่พร้อมขาย/หมดสต๊อก` : `${product.name || scanCode} is unavailable or out of stock.`;
          status.dataset.tone = "error";
          return;
        }
        const bridgeStatus = await addLookupProductToReactCart(product);
        if (destroyed || !generalSaleActive) return;
        if (bridgeStatus !== "added") {
          status.textContent = copy.addFailed;
          status.dataset.tone = "error";
          return;
        }
        status.textContent = lang === "lo" ? `ເພີ່ມ ${product.name} (${scanCode}) ໃນຕາຕະລາງແລ້ວ` : lang === "th" ? `เพิ่ม ${product.name} (${scanCode}) ลงตารางแล้ว` : `Added ${product.name} (${scanCode}) to the table.`;
        status.dataset.tone = "success";
        scheduleTableRender(0);
      } catch {
        status.textContent = copy.networkFailed;
        status.dataset.tone = "error";
      } finally {
        if (lookupTimeout !== null) window.clearTimeout(lookupTimeout);
        scanBusy = false;
        submit.disabled = false;
        submit.textContent = copy.add;
        // Do not steal focus when the cashier is entering a deposit/bill reference.
        if (document.activeElement === input || document.activeElement === document.body) input.focus();
        const nextCode = scanQueue.shift();
        if (nextCode && !destroyed && generalSaleActive) window.setTimeout(() => void submitScan(nextCode, status, input, submit), 0);
      }
    };

    const ensureScanner = () => {
      if ((!generalSaleAllowed && !opticalAllowed) || !generalSaleActive) {
        removeScanner();
        return;
      }
      if (scannerPanel?.isConnected) return;
      const existing = document.querySelector<HTMLElement>(`[${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"]`);
      if (existing) {
        scannerPanel = existing;
        scannerInput = existing.querySelector<HTMLInputElement>('input[data-pos-general-sale-sku="1"]') ?? existing.querySelector<HTMLInputElement>("form input");
        scannerSubmit = existing.querySelector<HTMLButtonElement>('button[type="submit"]');
        scannerStatus = existing.querySelector<HTMLElement>('[aria-live="polite"]');
        return;
      }
      const gridWrap = document.querySelector<HTMLElement>(PRODUCT_GRID_WRAP_QUERY);
      if (!gridWrap?.parentElement) return;

      const panel = document.createElement("section");
      panel.setAttribute(GENERAL_SALE_SCANNER_ATTRIBUTE, "1");
      panel.className = opticalActive
        ? "rounded-xl border border-emerald-100 bg-white p-3"
        : "grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3";
      panel.setAttribute("aria-label", opticalActive ? copy.opticalScannerAria : copy.groceryScannerAria);

      if (!opticalActive) {
        const heading = document.createElement("div");
        heading.className = "flex flex-wrap items-center justify-between gap-3";
        const headingCopy = document.createElement("div");
        headingCopy.className = "grid gap-1";
        headingCopy.append(
          createTextElement("strong", "text-sm font-black text-emerald-950", copy.groceryHeading),
          createTextElement("small", "text-xs font-bold text-emerald-700", copy.groceryHint)
        );
        const tableMode = createTextElement("span", "cpipos-sd-table-mode", copy.tableMode);
        heading.append(headingCopy, tableMode);
        panel.appendChild(heading);
      }

      const row = document.createElement("div");
      row.className = opticalActive ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid gap-2";
      const productGroup = document.createElement("div");
      productGroup.className = "min-w-0";
      const form = document.createElement("form");
      form.className = opticalActive ? "flex max-w-[440px] items-center gap-2" : "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]";
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      if (opticalActive) input.maxLength = 128;
      input.className = "posui-payment-modal__input min-w-0 flex-1";
      input.placeholder = opticalActive ? copy.opticalPlaceholder : copy.groceryPlaceholder;
      input.setAttribute("aria-label", copy.skuAria);
      input.setAttribute("data-pos-general-sale-sku", "1");
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "posui-btn posui-btn--primary shrink-0";
      submit.textContent = copy.add;
      const status = document.createElement("small");
      status.className = "block min-h-4 pt-1 text-xs font-bold text-slate-600";
      status.setAttribute("aria-live", "polite");
      form.append(input, submit);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (opticalAutoScanTimer !== null) {
          window.clearTimeout(opticalAutoScanTimer);
          opticalAutoScanTimer = null;
        }
        opticalFastKeyCount = 0;
        void submitScan(input.value, status, input, submit);
      });
      if (opticalActive) {
        // Automatic after barcode/paste/typing settles, including scanners
        // without an Enter suffix. No per-keystroke backend requests.
        input.addEventListener("keydown", (event) => {
          if (event.key.length !== 1) return;
          const now = window.performance.now();
          opticalFastKeyCount = now - opticalLastKeyAt <= OPTICAL_SCAN_KEY_INTERVAL_MS ? opticalFastKeyCount + 1 : 1;
          opticalLastKeyAt = now;
        });
        input.addEventListener("input", (event) => {
          if (opticalAutoScanTimer !== null) window.clearTimeout(opticalAutoScanTimer);
          opticalAutoScanTimer = null;
          const raw = input.value.trim();
          const code = normalizeGeneralSaleScanCode(raw);
          const paste = event instanceof InputEvent
            && (event.inputType === "insertFromPaste" || (event.data?.length ?? 0) >= 4);
          // Evaluate only a COMPLETED input burst/idle. Some Bluetooth scanners
          // type slowly or omit Enter; a prefixed SKU such as QA-LAK-FRAME-001
          // normalizes to short numeric digits ("001") and must still work.
          // Keep this behavior strictly inside the IT-authorized Optical mode.
          if (!code || raw.length < 3) return;
          const delay = paste || opticalFastKeyCount >= 5 ? OPTICAL_SCAN_IDLE_MS : OPTICAL_MANUAL_IDLE_MS;
          opticalAutoScanTimer = window.setTimeout(() => {
            opticalAutoScanTimer = null;
            if (destroyed || !opticalActive || !opticalAllowed || !generalSaleActive || input.value.trim() !== raw) return;
            opticalFastKeyCount = 0;
            void submitScan(raw, status, input, submit);
          }, delay);
        });
        input.addEventListener("blur", () => {
          if (opticalAutoScanTimer !== null) window.clearTimeout(opticalAutoScanTimer);
          opticalAutoScanTimer = null;
        });
      }
      productGroup.append(form, status);
      row.appendChild(productGroup);

      if (opticalActive) {
        const billGroup = document.createElement("div");
        billGroup.className = "min-w-0";
        const billForm = document.createElement("form");
        billForm.className = "flex items-center gap-2";
        const billInput = document.createElement("input");
        billInput.type = "text";
        billInput.inputMode = "text";
        billInput.autocomplete = "off";
        billInput.spellcheck = false;
        billInput.maxLength = 256;
        billInput.className = "posui-payment-modal__input min-w-0 flex-1";
        billInput.placeholder = copy.billPlaceholder;
        billInput.setAttribute("aria-label", copy.billAria);
        const billSubmit = document.createElement("button");
        billSubmit.type = "submit";
        billSubmit.className = "posui-btn shrink-0";
        billSubmit.textContent = copy.billSearch;
        const billStatus = document.createElement("small");
        billStatus.className = "block min-h-4 pt-1 text-xs font-semibold text-amber-800";
        billStatus.setAttribute("aria-live", "polite");
        billForm.append(billInput, billSubmit);
        let lastBillKeyAt = 0;
        let billBurst = 0;
        billInput.addEventListener("keydown", (event) => {
          if (event.key.length !== 1) return;
          const now = window.performance.now();
          billBurst = now - lastBillKeyAt <= OPTICAL_SCAN_KEY_INTERVAL_MS ? billBurst + 1 : 1;
          lastBillKeyAt = now;
        });
        billInput.addEventListener("input", (event) => {
          if (opticalBillScanTimer !== null) window.clearTimeout(opticalBillScanTimer);
          opticalBillScanTimer = null;
          const reference = billInput.value.trim();
          const paste = event instanceof InputEvent
            && (event.inputType === "insertFromPaste" || (event.data?.length ?? 0) >= 4);
          if (reference.length < (paste ? 4 : 6) || (!paste && billBurst < 5)) return;
          opticalBillScanTimer = window.setTimeout(() => {
            opticalBillScanTimer = null;
            if (destroyed || !opticalActive || !generalSaleActive || billInput.value.trim() !== reference) return;
            billBurst = 0;
            // Request is intentionally read-only until ledger-backed retrieval
            // can prohibit paid/void invoices and duplicate bill settlement.
            billForm.requestSubmit();
          }, OPTICAL_SCAN_IDLE_MS);
        });
        billInput.addEventListener("blur", () => {
          if (opticalBillScanTimer !== null) window.clearTimeout(opticalBillScanTimer);
          opticalBillScanTimer = null;
        });
        billForm.addEventListener("submit", (event) => {
          event.preventDefault();
          if (opticalBillScanTimer !== null) window.clearTimeout(opticalBillScanTimer);
          opticalBillScanTimer = null;
          if (!billInput.value.trim()) {
            billStatus.textContent = copy.billRequired;
            return;
          }
          // Read-only UI placeholder until tenant-scoped deposit/job APIs,
          // reconciliation and idempotent settlement are ready.
          billStatus.textContent = copy.billDisabled;
        });
        billGroup.append(billForm, billStatus);
        row.appendChild(billGroup);
      }
      panel.appendChild(row);
      gridWrap.parentElement.insertBefore(panel, gridWrap);
      scannerPanel = panel;
      scannerInput = input;
      scannerSubmit = submit;
      scannerStatus = status;
      ensureTableHost();
      scheduleTableRender(0);
      window.setTimeout(() => input.focus(), 0);
    };

    const enhanceSelector = () => {
      if (!accessResolved || (!generalSaleAllowed && !opticalAllowed)) {
        deactivateGeneralSale();
        removeGeneralSaleButton();
        return;
      }
      const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
      if (!selector || selector.getAttribute(MODE_ENHANCED_ATTRIBUTE) !== "1") return;
      const grid = selector.querySelector<HTMLElement>(MODE_GRID_QUERY);
      if (!grid) return;
      let generalSaleButton = grid.querySelector<HTMLButtonElement>(`[${GENERAL_SALE_BUTTON_ATTRIBUTE}="1"]`);
      if (!generalSaleButton && generalSaleAllowed) {
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
          createTextElement("strong", "", generalSaleUi[lang].generalMode),
          createTextElement("small", "", generalSaleUi[lang].generalModeHint)
        );
        const check = createTextElement("span", "posui-mode-option__check", "✓");
        check.setAttribute("aria-hidden", "true");
        generalSaleButton.append(icon, copy, check);
        generalSaleButton.addEventListener("click", () => {
          if (!generalSaleAllowed) return;
          // The SD mode is independently authorized. Never click the public
          // Home card: it may be hidden by a CUSTOM contract.
          window.dispatchEvent(new Event(GENERAL_SALE_ACTIVATE_BASE_MODE_EVENT));
          if (opticalActive) window.dispatchEvent(new Event(OPTICAL_DEACTIVATE_BASE_MODE_EVENT));
          generalSaleActive = true;
          opticalActive = false;
          removeScanner();
          removeTable();
          setRootMode(true);
          window.setTimeout(() => {
            if (destroyed || !generalSaleActive) return;
            setModeVisualState();
            ensureScanner();
            scheduleTableRender(0);
          }, 0);
        });
        grid.appendChild(generalSaleButton);
      }
      if (!generalSaleAllowed) generalSaleButton?.remove();

      let opticalButton = grid.querySelector<HTMLButtonElement>(`[${OPTICAL_BUTTON_ATTRIBUTE}="1"]`);
      if (!opticalAllowed) {
        opticalButton?.remove();
      } else if (!opticalButton) {
        opticalButton = document.createElement("button");
        opticalButton.type = "button";
        opticalButton.className = "posui-mode-option";
        opticalButton.setAttribute(MODE_ATTRIBUTE, OPTICAL_MODE_ID);
        opticalButton.setAttribute(OPTICAL_BUTTON_ATTRIBUTE, "1");
        opticalButton.style.order = "100";
        opticalButton.style.borderColor = "#6ee7b7";
        const label = document.createElement("span");
        label.className = "posui-mode-option__copy";
        label.append(
          createTextElement("strong", "", generalSaleUi[lang].opticalMode),
          createTextElement("small", "", generalSaleUi[lang].opticalModeHint)
        );
        opticalButton.append(
          createTextElement("span", "posui-mode-option__icon", "◉"),
          label,
          createTextElement("span", "posui-mode-option__check", "✓")
        );
        opticalButton.addEventListener("click", () => {
          if (!opticalAllowed) return;
          // Optical retains the existing POS checkout pipeline even when
          // IT has disabled the public takeaway button. No synthetic click.
          window.dispatchEvent(new Event(OPTICAL_ACTIVATE_BASE_MODE_EVENT));
          generalSaleActive = true;
          opticalActive = true;
          removeScanner();
          removeTable();
          setRootMode(true);
          window.setTimeout(() => {
            if (destroyed || !opticalAllowed || !generalSaleActive || !opticalActive) return;
            setModeVisualState();
            ensureScanner();
            ensureTableHost();
            scheduleTableRender(0);
          }, 0);
        });
        grid.appendChild(opticalButton);
      }
      setModeVisualState();
    };

    const applyRetailStartup = (request: PosStartupModeRequest) => {
      if (request.mode !== OPTICAL_MODE_ID && request.mode !== GENERAL_SALE_MODE_ID) return;
      if (processingStartupRequestId === request.requestId) return;
      // POS sales is dynamically imported after session validation. Its
      // Optical activation listener is registered after React mounts the
      // sales screen, not when the IT feature request first resolves.
      if (document.documentElement.getAttribute(OPTICAL_HANDLER_READY_ATTRIBUTE) !== "1") {
        pendingStartupMode = request;
        return;
      }
      processingStartupRequestId = request.requestId;
      const allowed = request.mode === OPTICAL_MODE_ID ? opticalAllowed : generalSaleAllowed;
      if (allowed) {
        if (request.mode === OPTICAL_MODE_ID) {
          // The underlying order type can stay takeaway, but the visible UI
          // must start in Optical without opening the modal or clicking home.
          window.dispatchEvent(new Event(OPTICAL_ACTIVATE_BASE_MODE_EVENT));
          generalSaleActive = true;
          opticalActive = true;
        } else {
          // Standalone general sale must not depend on the Home/takeaway card.
          window.dispatchEvent(new Event(GENERAL_SALE_ACTIVATE_BASE_MODE_EVENT));
          if (opticalActive) window.dispatchEvent(new Event(OPTICAL_DEACTIVATE_BASE_MODE_EVENT));
          generalSaleActive = true;
          opticalActive = false;
        }
        removeScanner();
        removeTable();
        setRootMode(true);
        setModeVisualState();
        ensureScanner();
        ensureTableHost();
        scheduleTableRender(0);
      }
      // Do not remove the startup loading screen before the React Optical
      // header has actually committed. Otherwise a frame of the old home UI
      // can flash between the event and the component's next render.
      const reportWhenRendered = (attempt: number) => {
        if (destroyed) return;
        const correctMode = request.mode === OPTICAL_MODE_ID
          ? opticalActive && Boolean(document.querySelector('[data-testid="pos-active-optical-mode"]'))
          : generalSaleActive && !opticalActive
            && document.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE) === GENERAL_SALE_MODE_ID;
        // The sales module registers its Optical listener in a React effect.
        // During shift entry, subsequent hydration/reconciliation can briefly
        // detach that effect between the readiness probe and our first event.
        // A startup request is already authenticated and the cashier is gated;
        // re-issue ONLY the Optical UI activation if no Optical header appeared.
        // Do not re-submit an order, alter the bill, or call a payment API.
        if (allowed && !correctMode && request.mode === OPTICAL_MODE_ID
          && (attempt === 30 || attempt === 75 || attempt === 130)
          && document.documentElement.getAttribute(OPTICAL_HANDLER_READY_ATTRIBUTE) === "1") {
          window.dispatchEvent(new Event(OPTICAL_ACTIVATE_BASE_MODE_EVENT));
          ensureScanner();
          ensureTableHost();
        }
        if (allowed && !correctMode && attempt < 450) {
          window.setTimeout(() => reportWhenRendered(attempt + 1), 40);
          return;
        }
        const result: PosStartupModeResult = {
          requestId: request.requestId,
          mode: request.mode,
          activated: allowed && correctMode
        };
        window.dispatchEvent(new CustomEvent(POS_STARTUP_MODE_RESULT_EVENT, { detail: result }));
      };
      reportWhenRendered(0);
    };

    const onStartupMode = (event: Event) => {
      const request = (event as CustomEvent<PosStartupModeRequest>).detail;
      if (!request?.requestId || (request.mode !== OPTICAL_MODE_ID && request.mode !== GENERAL_SALE_MODE_ID)) return;
      if (request.requestId === processingStartupRequestId || request.requestId === pendingStartupMode?.requestId) return;
      // Wait for, or retry, the controller's own authenticated fresh grant.
      // This covers an early temporary feature-fetch failure without reading
      // browser cache or opening a disallowed sales mode.
      const allowed = request.mode === OPTICAL_MODE_ID ? opticalAllowed : generalSaleAllowed;
      if (!accessResolved || !allowed) {
        pendingStartupMode = request;
        if (accessResolved) {
          // Invalidate the previously denied snapshot before the deferred
          // renderer runs; it must await the fresh IT state instead of
          // rejecting a newly enabled Optical entitlement too early.
          accessResolved = false;
          void loadAccess();
        }
        return;
      }
      applyRetailStartup(request);
    };

    const onModeClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const modeCard = event.target.closest<HTMLElement>(`[${MODE_ATTRIBUTE}]`);
      if (!modeCard) return;
      const mode = modeCard.getAttribute(MODE_ATTRIBUTE);
      if (mode && mode !== GENERAL_SALE_MODE_ID && mode !== OPTICAL_MODE_ID) deactivateGeneralSale();
    };

    const onTableClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>(`[${GENERAL_SALE_TABLE_ATTRIBUTE}="1"] button[data-sd-action][data-sd-index]`);
      if (!button) return;
      const index = Number(button.dataset.sdIndex ?? "-1");
      const action = button.dataset.sdAction;
      if (!Number.isInteger(index) || index < 0) return;
      if (action !== "decrease" && action !== "increase" && action !== "delete") return;
      invokeCartAction(index, action);
      scheduleTableRender(0);
      window.setTimeout(() => scannerInput?.focus(), 0);
    };

    const reconcile = () => {
      if (destroyed) return;
      const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
      if (selector !== latestSelector) {
        latestSelector = selector;
        // A sales-mode dialog may open long after the first POS page load.
        // Re-fetch the authoritative IT toggles every time this dialog opens.
        if (selector) void loadAccess();
      }
      enhanceSelector();
      // The React sales topbar is the source of truth for the committed mode.
      // This legacy scanner/table adapter follows it, after verifying the IT
      // allowlist; it no longer determines whether POS startup may complete.
      const reactMode = document.querySelector<HTMLElement>(".posui-sales-topbar")
        ?.getAttribute("data-pos-react-sales-mode");
      if (accessResolved && reactMode === OPTICAL_MODE_ID && opticalAllowed) {
        generalSaleActive = true;
        opticalActive = true;
      } else if (accessResolved && reactMode === GENERAL_SALE_MODE_ID && generalSaleAllowed) {
        generalSaleActive = true;
        opticalActive = false;
      } else if (reactMode && generalSaleActive
        && reactMode !== OPTICAL_MODE_ID && reactMode !== GENERAL_SALE_MODE_ID) {
        deactivateGeneralSale();
      }
      // When POS has mounted after the entitlement request, activate exactly
      // once with the already checked grant. No public takeaway mode is needed.
      if (pendingStartupMode && accessResolved && document.documentElement.getAttribute(OPTICAL_HANDLER_READY_ATTRIBUTE) === "1") {
        const request = pendingStartupMode;
        pendingStartupMode = null;
        applyRetailStartup(request);
      }
      if (!generalSaleActive) return;
      setRootMode(true);
      setModeVisualState();
      ensureScanner();
      ensureTableHost();
    };

    const scheduleReconcile = () => {
      if (destroyed || reconcileFrame !== null) return;
      reconcileFrame = window.requestAnimationFrame(() => {
        reconcileFrame = null;
        reconcile();
      });
    };

    const isInternalMutation = (mutation: MutationRecord) => {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      return Boolean(target?.closest(`[${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"], [${GENERAL_SALE_TABLE_ATTRIBUTE}="1"]`));
    };

    async function loadAccess() {
      const sequence = ++accessSequence;
      let shouldRetryPending = false;
      try {
        const response = await fetch("/api/pos/features?refresh=1", {
          cache: "no-store",
          credentials: "same-origin"
        });
        const body = (await response.json().catch(() => null)) as PosFeaturesResponse | null;
        if (destroyed || sequence !== accessSequence) return;
        if (!response.ok || !body?.data) throw new Error("pos_feature_snapshot_unavailable");
        pendingStartupRetryCount = 0;
        window.dispatchEvent(new CustomEvent("cpipos:pos-feature-policy-updated", { detail: body.data }));
        generalSaleAllowed = Boolean(body?.data?.features?.[POS_MODE_FEATURES.general_sale] === true
          && body?.data?.sales_modes?.general_sale === true);
        // Optical is independently enabled by IT for this CUSTOM tenant.
        // The ordinary takeaway feature is not a prerequisite for entering its UI.
        opticalAllowed = isAuthorizedOpticalRetailMode(body.data);
        // When IT removes a grant while a retail mode is active, close the
        // extra scanner UI without modifying any existing bill/cart data.
        if (generalSaleActive && (opticalActive ? !opticalAllowed : !generalSaleAllowed)) {
          deactivateGeneralSale();
        }
      } catch {
        if (destroyed || sequence !== accessSequence) return;
        // A temporary Supabase/network failure must not be reported as a
        // revoked IT Optical grant. Retry only a pending startup, at most twice.
        shouldRetryPending = pendingStartupMode !== null && pendingStartupRetryCount < 2;
        if (!shouldRetryPending) {
          generalSaleAllowed = false;
          opticalAllowed = false;
          if (generalSaleActive) deactivateGeneralSale();
        }
      } finally {
        if (!destroyed && sequence === accessSequence) {
          if (shouldRetryPending) {
            accessResolved = false;
            pendingStartupRetryCount += 1;
            if (pendingStartupRetryTimer !== null) window.clearTimeout(pendingStartupRetryTimer);
            pendingStartupRetryTimer = window.setTimeout(() => {
              pendingStartupRetryTimer = null;
              if (!destroyed) void loadAccess();
            }, pendingStartupRetryCount * 400);
          } else {
            accessResolved = true;
            const startup = pendingStartupMode;
            pendingStartupMode = null;
            if (startup) applyRetailStartup(startup);
            scheduleReconcile();
          }
        }
      }
    }

    const onCartMutated = () => scheduleTableRender(0);
    const onCurrencyUpdated = () => scheduleTableRender(0);
    const onStorage = (event: StorageEvent) => {
      if (event.key === POS_TAKEAWAY_CART_STORAGE_KEY || event.key === POS_SALES_SNAPSHOT_STORAGE_KEY) scheduleTableRender(0);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      scheduleReconcile();
      if (latestSelector) void loadAccess();
    };
    const onFocus = () => {
      if (latestSelector) void loadAccess();
    };
    // Refresh on modal opening, tab activation and focus rather than polling
    // Supabase every few seconds on tablets left open throughout the day.

    document.addEventListener("click", onModeClick, true);
    document.addEventListener("click", onTableClick, true);
    window.addEventListener(POS_STARTUP_MODE_REQUEST_EVENT, onStartupMode as EventListener);
    window.addEventListener("cpipos:optical-handler-ready", scheduleReconcile);
    window.addEventListener(CART_MUTATED_EVENT, onCartMutated);
    window.addEventListener("cpipos:store-currency-updated", onCurrencyUpdated);
    const currencyObserver = new MutationObserver(() => scheduleTableRender(0));
    currencyObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-pos-store-currency"] });
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    const observer = new MutationObserver((mutations) => {
      if (document.visibilityState !== "visible") return;
      if (mutations.length > 0 && mutations.every(isInternalMutation)) return;
      scheduleReconcile();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-pos-react-sales-mode"] });
    void loadAccess();
    scheduleReconcile();

    return () => {
      destroyed = true;
      if (tableRenderTimer !== null) window.clearTimeout(tableRenderTimer);
      if (reconcileFrame !== null) window.cancelAnimationFrame(reconcileFrame);
      observer.disconnect();
      currencyObserver.disconnect();
      document.removeEventListener("click", onModeClick, true);
      document.removeEventListener("click", onTableClick, true);
      window.removeEventListener(POS_STARTUP_MODE_REQUEST_EVENT, onStartupMode as EventListener);
      window.removeEventListener("cpipos:optical-handler-ready", scheduleReconcile);
      window.removeEventListener(CART_MUTATED_EVENT, onCartMutated);
      window.removeEventListener("cpipos:store-currency-updated", onCurrencyUpdated);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      accessSequence += 1;
      deactivateGeneralSale();
      removeGeneralSaleButton();
      document.getElementById(GENERAL_SALE_STYLE_ID)?.remove();
      scanQueue.length = 0;
      lookupProductsById.clear();
      void scannerSubmit;
      void scannerStatus;
    };
  }, [lang]);

  return null;
}

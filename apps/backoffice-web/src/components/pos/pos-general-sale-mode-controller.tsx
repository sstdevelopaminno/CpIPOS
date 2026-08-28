"use client";

import { useEffect } from "react";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";
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
  GENERAL_SALE_LAYOUT_ATTRIBUTE,
  GENERAL_SALE_LAYOUT_STORAGE_KEY,
  GENERAL_SALE_MODE_ID,
  GENERAL_SALE_ROOT_ATTRIBUTE,
  normalizeGeneralSaleCartLayout,
  normalizeGeneralSaleScanCode,
  type GeneralSaleAddProductRequest,
  type GeneralSaleAddProductResult,
  type GeneralSaleCartLayout,
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
const GENERAL_SALE_TABLE_ATTRIBUTE = "data-pos-general-sale-cart-table";
const GENERAL_SALE_STYLE_ID = "cpipos-general-sale-layout-style";
const POS_TAKEAWAY_CART_STORAGE_KEY = "pos_sales_cart_v012";
const POS_SALES_SNAPSHOT_STORAGE_KEY = "pos_sales_snapshot_v001";
const CART_BRIDGE_TIMEOUT_MS = 1800;
const CART_RENDER_DELAY_MS = 180;
const MAX_QUEUED_SCANS = 25;

function resolveLang(): Lang {
  return document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "th";
}

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
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function readLayoutPreference(): GeneralSaleCartLayout {
  try {
    return normalizeGeneralSaleCartLayout(window.localStorage.getItem(GENERAL_SALE_LAYOUT_STORAGE_KEY));
  } catch {
    return "grid";
  }
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
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${GENERAL_SALE_LAYOUT_ATTRIBUTE}="table"] .posui-category-col,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${GENERAL_SALE_LAYOUT_ATTRIBUTE}="table"] .posui-topbar-category-slot,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${GENERAL_SALE_LAYOUT_ATTRIBUTE}="table"] ${PRODUCT_GRID_WRAP_QUERY} { display: none !important; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${GENERAL_SALE_LAYOUT_ATTRIBUTE}="table"] .posui-cart-col .posui-cart-items,
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${GENERAL_SALE_LAYOUT_ATTRIBUTE}="table"] .posui-cart-col .posui-cart-empty { display: none !important; }
    html[${GENERAL_SALE_ROOT_ATTRIBUTE}="${GENERAL_SALE_MODE_ID}"][${GENERAL_SALE_LAYOUT_ATTRIBUTE}="table"] [${GENERAL_SALE_TABLE_ATTRIBUTE}="1"] { display: grid; }
    .cpipos-sd-layout-switch { display: inline-flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid #a7f3d0; border-radius: 10px; background: #fff; }
    .cpipos-sd-layout-switch button { border: 0; border-radius: 8px; background: transparent; color: #065f46; padding: 7px 10px; font-size: 12px; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .cpipos-sd-layout-switch button.is-active { background: #059669; color: #fff; }
    .cpipos-sd-table { min-width: 0; gap: 10px; border: 1px solid #dbe7e3; border-radius: 14px; background: #fff; overflow: hidden; }
    .cpipos-sd-table__summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: #f0fdf4; border-bottom: 1px solid #d1fae5; }
    .cpipos-sd-table__summary p { margin: 0; color: #065f46; font-size: 13px; font-weight: 800; }
    .cpipos-sd-table__summary strong { color: #ea580c; font-size: 18px; font-weight: 900; }
    .cpipos-sd-table__scroll { width: 100%; overflow: auto; max-height: min(58vh, 620px); }
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
      .cpipos-sd-layout-switch { width: 100%; }
      .cpipos-sd-layout-switch button { flex: 1; }
      .cpipos-sd-table__summary { align-items: flex-start; flex-direction: column; }
    }
  `;
  document.head.appendChild(style);
}

export function PosGeneralSaleModeController() {
  useEffect(() => {
    let destroyed = false;
    let accessResolved = false;
    let generalSaleAllowed = false;
    let generalSaleActive = false;
    let generalSaleLayout = readLayoutPreference();
    let scannerPanel: HTMLElement | null = null;
    let scannerInput: HTMLInputElement | null = null;
    let scannerSubmit: HTMLButtonElement | null = null;
    let scannerStatus: HTMLElement | null = null;
    let tableHost: HTMLElement | null = null;
    let tableRenderTimer: number | null = null;
    let lastTableSignature = "";
    let scanBusy = false;
    const scanQueue: string[] = [];
    const lookupProductsById = new Map<string, GeneralSaleLookupProduct>();

    const lang = resolveLang();
    ensureGeneralSaleStyles();

    const setRootMode = (active: boolean) => {
      if (active) {
        document.documentElement.setAttribute(GENERAL_SALE_ROOT_ATTRIBUTE, GENERAL_SALE_MODE_ID);
        document.documentElement.setAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE, generalSaleLayout);
      } else {
        if (document.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE) === GENERAL_SALE_MODE_ID) {
          document.documentElement.removeAttribute(GENERAL_SALE_ROOT_ATTRIBUTE);
        }
        document.documentElement.removeAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE);
      }
    };

    const setModeVisualState = () => {
      const selector = document.querySelector<HTMLElement>(MODE_SELECTOR_QUERY);
      const generalSaleButton = selector?.querySelector<HTMLButtonElement>(`[${GENERAL_SALE_BUTTON_ATTRIBUTE}="1"]`) ?? null;
      const homeButton = selector?.querySelector<HTMLElement>(`[${MODE_ATTRIBUTE}="${GENERAL_SALE_CHECKOUT_BASE_MODE}"]`) ?? null;
      generalSaleButton?.classList.toggle("is-active", generalSaleActive);
      if (generalSaleActive) homeButton?.classList.remove("is-active");
    };

    const updateLayoutVisualState = () => {
      scannerPanel?.querySelectorAll<HTMLButtonElement>("[data-sd-layout]").forEach((button) => {
        const active = button.dataset.sdLayout === generalSaleLayout;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
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
      scannerPanel?.remove();
      scannerPanel = null;
      scannerInput = null;
      scannerSubmit = null;
      scannerStatus = null;
      document.querySelectorAll<HTMLElement>(`[${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };

    const deactivateGeneralSale = () => {
      generalSaleActive = false;
      setRootMode(false);
      setModeVisualState();
      removeTable();
      removeScanner();
    };

    const removeGeneralSaleButton = () => {
      document.querySelectorAll<HTMLElement>(`[${GENERAL_SALE_BUTTON_ATTRIBUTE}="1"]`).forEach((node) => node.remove());
    };

    const ensureTableHost = () => {
      if (!generalSaleAllowed || !generalSaleActive) {
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
      host.setAttribute("aria-label", lang === "th" ? "ตารางสินค้าขายทั่วไป SD" : "SD general sale cart table");
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

    const renderScannerTable = () => {
      tableRenderTimer = null;
      if (destroyed || !generalSaleActive || generalSaleLayout !== "table") return;
      const host = ensureTableHost();
      if (!host) return;

      let cartText: string | null = null;
      let snapshotText: string | null = null;
      try {
        cartText = window.localStorage.getItem(POS_TAKEAWAY_CART_STORAGE_KEY);
        snapshotText = window.localStorage.getItem(POS_SALES_SNAPSHOT_STORAGE_KEY);
      } catch {
        // Storage can be unavailable in hardened/private WebViews; render an empty table safely.
      }

      const rows = buildGeneralSaleCartTableRows({
        cart: parseGeneralSaleCartStorage(cartText),
        snapshotProducts: parseGeneralSaleSalesSnapshot(snapshotText),
        lookupProducts: lookupProductsById.values()
      });
      const signature = `${generalSaleLayout}:${buildGeneralSaleCartTableSignature(rows)}`;
      if (signature === lastTableSignature && host.childElementCount > 0) return;
      lastTableSignature = signature;

      const summary = document.createElement("header");
      summary.className = "cpipos-sd-table__summary";
      const count = rows.reduce((sum, row) => sum + row.quantity, 0);
      const total = rows.reduce((sum, row) => sum + row.lineTotal, 0);
      summary.append(
        createTextElement("p", "", lang === "th" ? `ตารางขายสินค้า · ${count} ชิ้น · ${rows.length} รายการ` : `Scanner cart · ${count} units · ${rows.length} lines`),
        createTextElement("strong", "", formatMoney(total))
      );

      const scroll = document.createElement("div");
      scroll.className = "cpipos-sd-table__scroll";

      if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "cpipos-sd-table__empty";
        empty.textContent = lang === "th" ? "ยังไม่มีสินค้า · ยิงบาร์โค้ดหรือกรอก SKU ด้านบนเพื่อเพิ่มสินค้า" : "No items yet. Scan a barcode or enter an SKU above.";
        scroll.appendChild(empty);
      } else {
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        const headers = lang === "th"
          ? ["#", "SKU / บาร์โค้ด", "หมวดหมู่", "สินค้า", "จำนวน", "ราคา/หน่วย", "ราคารวม", "ลบ"]
          : ["#", "SKU / barcode", "Category", "Product", "Qty", "Unit price", "Total", "Remove"];
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
          const name = createTextElement("strong", "", row.name);
          nameCell.appendChild(name);
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
          decrease.setAttribute("aria-label", lang === "th" ? `ลดจำนวน ${row.name}` : `Decrease ${row.name}`);
          const qtyValue = createTextElement("span", "", String(row.quantity));
          const increase = document.createElement("button");
          increase.type = "button";
          increase.textContent = "+";
          increase.dataset.sdAction = "increase";
          increase.dataset.sdIndex = String(index);
          increase.setAttribute("aria-label", lang === "th" ? `เพิ่มจำนวน ${row.name}` : `Increase ${row.name}`);
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
          remove.setAttribute("aria-label", lang === "th" ? `ลบ ${row.name}` : `Remove ${row.name}`);
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
      if (!generalSaleActive || generalSaleLayout !== "table") return;
      if (tableRenderTimer !== null) window.clearTimeout(tableRenderTimer);
      tableRenderTimer = window.setTimeout(renderScannerTable, delayMs);
    };

    const setGeneralSaleLayout = (layout: GeneralSaleCartLayout) => {
      generalSaleLayout = layout;
      if (generalSaleActive) document.documentElement.setAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE, layout);
      try {
        window.localStorage.setItem(GENERAL_SALE_LAYOUT_STORAGE_KEY, layout);
      } catch {
        // Layout preference persistence is optional.
      }
      updateLayoutVisualState();
      if (layout === "table") {
        ensureTableHost();
        scheduleTableRender(0);
        window.setTimeout(() => scannerInput?.focus(), 0);
      } else {
        lastTableSignature = "";
        window.setTimeout(() => scannerInput?.focus(), 0);
      }
    };

    const submitScan = async (rawCode: string, status: HTMLElement, input: HTMLInputElement, submit: HTMLButtonElement) => {
      const scanCode = normalizeGeneralSaleScanCode(rawCode);
      if (!scanCode) {
        status.textContent = lang === "th" ? "กรุณาสแกนหรือกรอกรหัส SKU สินค้า" : "Scan or enter a product SKU.";
        status.dataset.tone = "error";
        input.focus();
        return;
      }

      input.value = "";
      if (scanBusy) {
        if (scanQueue.length >= MAX_QUEUED_SCANS) {
          status.textContent = lang === "th" ? "คิวสแกนเต็ม กรุณารอสักครู่แล้วสแกนใหม่" : "Scan queue is full. Wait briefly and scan again.";
          status.dataset.tone = "error";
          return;
        }
        scanQueue.push(scanCode);
        status.textContent = lang === "th" ? `รับรหัส ${scanCode} เข้าคิวแล้ว · รอ ${scanQueue.length} รายการ` : `Queued ${scanCode} · ${scanQueue.length} waiting`;
        status.dataset.tone = "pending";
        return;
      }

      scanBusy = true;
      submit.dataset.busy = "1";
      submit.textContent = lang === "th" ? "กำลังเพิ่ม..." : "Adding...";
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
          return;
        }

        const product = body.data.product;
        lookupProductsById.set(product.id, product);
        if (product.is_active === false || product.is_out_of_stock === true) {
          status.textContent = lang === "th" ? `สินค้า ${product.name || scanCode} ไม่พร้อมขาย/หมดสต๊อก` : `${product.name || scanCode} is unavailable or out of stock.`;
          status.dataset.tone = "error";
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
          return;
        }

        status.textContent = lang === "th" ? `เพิ่ม ${product.name} (${scanCode}) ลงตะกร้าแล้ว` : `Added ${product.name} (${scanCode}) to the cart.`;
        status.dataset.tone = "success";
        scheduleTableRender();
      } catch {
        status.textContent = lang === "th" ? "เชื่อมต่อค้นหาสินค้าไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่" : "Product lookup connection failed. Check the network and retry.";
        status.dataset.tone = "error";
      } finally {
        scanBusy = false;
        submit.dataset.busy = "0";
        submit.textContent = lang === "th" ? "เพิ่มสินค้า" : "Add item";
        input.focus();
        const nextCode = scanQueue.shift();
        if (nextCode && !destroyed && generalSaleActive) {
          window.setTimeout(() => void submitScan(nextCode, status, input, submit), 0);
        }
      }
    };

    const ensureScanner = () => {
      if (!generalSaleAllowed || !generalSaleActive) {
        removeScanner();
        return;
      }

      if (scannerPanel?.isConnected) {
        updateLayoutVisualState();
        return;
      }
      const existing = document.querySelector<HTMLElement>(`[${GENERAL_SALE_SCANNER_ATTRIBUTE}="1"]`);
      if (existing) {
        scannerPanel = existing;
        scannerInput = existing.querySelector<HTMLInputElement>('input[aria-label="รหัส SKU สินค้า"], input[aria-label="Product SKU"]');
        scannerSubmit = existing.querySelector<HTMLButtonElement>('button[type="submit"]');
        scannerStatus = existing.querySelector<HTMLElement>('[aria-live="polite"]');
        updateLayoutVisualState();
        return;
      }

      const gridWrap = document.querySelector<HTMLElement>(PRODUCT_GRID_WRAP_QUERY);
      if (!gridWrap?.parentElement) return;

      const panel = document.createElement("section");
      panel.setAttribute(GENERAL_SALE_SCANNER_ATTRIBUTE, "1");
      panel.className = "grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3";
      panel.setAttribute("aria-label", lang === "th" ? "สแกนสินค้าโหมดขายทั่วไป SD" : "SD general sale product scanner");

      const heading = document.createElement("div");
      heading.className = "flex flex-wrap items-center justify-between gap-3";
      const headingCopy = document.createElement("div");
      headingCopy.className = "grid gap-1";
      headingCopy.append(
        createTextElement("strong", "text-sm font-black text-emerald-950", lang === "th" ? "SD · ขายทั่วไป · สแกน SKU" : "SD · General Sale · SKU scan"),
        createTextElement("small", "text-xs font-bold text-emerald-700", lang === "th" ? "ค้นหาจากเมนูจัดการสินค้า แล้วเพิ่มลงตะกร้า POS อัตโนมัติ" : "Looks up Product Management and adds to the POS cart automatically")
      );

      const layoutSwitch = document.createElement("div");
      layoutSwitch.className = "cpipos-sd-layout-switch";
      layoutSwitch.setAttribute("role", "group");
      layoutSwitch.setAttribute("aria-label", lang === "th" ? "รูปแบบหน้าขาย SD" : "SD sales layout");
      const gridButton = document.createElement("button");
      gridButton.type = "button";
      gridButton.dataset.sdLayout = "grid";
      gridButton.textContent = lang === "th" ? "สินค้า + ตะกร้า" : "Products + cart";
      gridButton.addEventListener("click", () => setGeneralSaleLayout("grid"));
      const tableButton = document.createElement("button");
      tableButton.type = "button";
      tableButton.dataset.sdLayout = "table";
      tableButton.textContent = lang === "th" ? "สแกน + ตาราง" : "Scan + table";
      tableButton.addEventListener("click", () => setGeneralSaleLayout("table"));
      layoutSwitch.append(gridButton, tableButton);
      heading.append(headingCopy, layoutSwitch);

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
      scannerInput = input;
      scannerSubmit = submit;
      scannerStatus = status;
      updateLayoutVisualState();
      if (generalSaleLayout === "table") {
        ensureTableHost();
        scheduleTableRender(0);
      }
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
          createTextElement("small", "", lang === "th" ? "SKU/บาร์โค้ด · สินค้า + ตารางสแกน" : "SKU/barcode · product grid + scan table")
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
          generalSaleLayout = readLayoutPreference();
          setRootMode(true);
          window.setTimeout(() => {
            if (destroyed || !generalSaleActive) return;
            setModeVisualState();
            ensureScanner();
            if (generalSaleLayout === "table") scheduleTableRender(0);
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

    const onTableClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>(`[${GENERAL_SALE_TABLE_ATTRIBUTE}="1"] button[data-sd-action][data-sd-index]`);
      if (!button) return;
      const index = Number(button.dataset.sdIndex ?? "-1");
      const action = button.dataset.sdAction;
      if (!Number.isInteger(index) || index < 0) return;
      if (action !== "decrease" && action !== "increase" && action !== "delete") return;
      invokeCartAction(index, action);
      scheduleTableRender();
      window.setTimeout(() => scannerInput?.focus(), 0);
    };

    const reconcile = () => {
      if (destroyed) return;
      enhanceSelector();
      ensureScanner();
      setModeVisualState();
      if (generalSaleActive && generalSaleLayout === "table") {
        ensureTableHost();
        scheduleTableRender();
      }
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
    document.addEventListener("click", onTableClick, true);
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { childList: true, subtree: true });
    void loadAccess();
    reconcile();

    return () => {
      destroyed = true;
      if (tableRenderTimer !== null) window.clearTimeout(tableRenderTimer);
      observer.disconnect();
      document.removeEventListener("click", onModeClick, true);
      document.removeEventListener("click", onTableClick, true);
      deactivateGeneralSale();
      removeGeneralSaleButton();
      document.getElementById(GENERAL_SALE_STYLE_ID)?.remove();
      scanQueue.length = 0;
      lookupProductsById.clear();
      void scannerSubmit;
      void scannerStatus;
    };
  }, []);

  return null;
}

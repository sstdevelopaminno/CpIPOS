"use client";

import { useEffect } from "react";

type SaleProduct = {
  id: string;
  sku?: string | null;
  name?: string | null;
  category?: string | null;
  price?: number | null;
};

type BundleItem = SaleProduct & {
  bundle_items?: Array<{
    product_id?: string;
    qty?: number;
  }>;
};

type BundleView = {
  items?: BundleItem[];
  eligible_items?: SaleProduct[];
};

type ApiBody<T> = {
  data?: T | null;
  error?: unknown;
};

type SelectionLine = { selected: boolean; qty: string };

type MutableState = {
  modal: HTMLElement | null;
  root: HTMLElement | null;
  bundleView: BundleView | null;
  featureAvailable: boolean | null;
  enabled: boolean;
  selection: Map<string, SelectionLine>;
  searchText: string;
  errorText: string;
  saving: boolean;
  loadToken: number;
};

const ROOT_ID = "cpipos-stock-bundle-inline-controls";

function textOf(element: Element | null) {
  return String(element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isStockHeading(text: string) {
  return (
    text.includes("จัดการสินค้าและสต๊อก") ||
    text.includes("Manage Catalog & Stock") ||
    text.startsWith("แก้ไขสินค้า:") ||
    text.startsWith("Edit Product:")
  );
}

function isSaveButtonText(text: string) {
  return (
    text.startsWith("บันทึกสินค้า") ||
    text.startsWith("บันทึกการเปลี่ยนแปลง") ||
    text.startsWith("Save Product") ||
    text.startsWith("Save Changes")
  );
}

function findSaveButton(modal: HTMLElement) {
  return (
    Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      isSaveButtonText(textOf(button)),
    ) ?? null
  );
}

function findStockProductModal() {
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>("h1,h2,h3,[role='heading']"),
  );
  const heading = headings.find((node) => isStockHeading(textOf(node)));
  if (!heading) return null;

  const dialog = heading.closest<HTMLElement>("[role='dialog']");
  if (dialog && findSaveButton(dialog)) return dialog;

  let node: HTMLElement | null = heading.parentElement;
  while (node && node !== document.body) {
    if (findSaveButton(node)) return node;
    node = node.parentElement;
  }
  return null;
}

function directChildContaining(modal: HTMLElement, descendant: HTMLElement) {
  let node = descendant;
  while (node.parentElement && node.parentElement !== modal) node = node.parentElement;
  return node;
}

function findIngredientSection(modal: HTMLElement) {
  const labels = Array.from(modal.querySelectorAll<HTMLElement>("label"));
  const label = labels.find((node) => {
    const text = textOf(node);
    return (
      text.includes("เปิดใส่วัตถุดิบ") ||
      text.includes("เปิดโหมดสูตรวัตถุดิบ") ||
      text.includes("Enable ingredient recipe mode")
    );
  });
  return label ? directChildContaining(modal, label) : null;
}

function findLabelControl(modal: HTMLElement, labels: string[]) {
  const candidates = Array.from(modal.querySelectorAll<HTMLLabelElement>("label"));
  for (const label of candidates) {
    const labelText = textOf(label);
    if (!labels.some((token) => labelText.includes(token))) continue;
    const control = label.querySelector<HTMLInputElement | HTMLSelectElement>(
      "input:not([type='checkbox']),select",
    );
    if (control) return control;
  }
  return null;
}

function findProductNameControl(modal: HTMLElement) {
  return (
    findLabelControl(modal, ["ชื่อสินค้า", "Product Name"]) ??
    modal.querySelector<HTMLInputElement>(
      'input[placeholder*="ชาไทย"],input[placeholder*="Thai Tea"],input[name="productName"]',
    )
  );
}

function findCategoryControl(modal: HTMLElement) {
  return (
    findLabelControl(modal, ["หมวดหมู่", "Category"]) ??
    modal.querySelector<HTMLInputElement | HTMLSelectElement>('[name="category"]')
  );
}

function findStorePriceControl(modal: HTMLElement) {
  return (
    findLabelControl(modal, ["ราคาหน้าร้าน", "Store Price"]) ??
    modal.querySelector<HTMLInputElement>('input[name="storePrice"]')
  );
}

function productNameFromHeading(modal: HTMLElement) {
  const heading = Array.from(
    modal.querySelectorAll<HTMLElement>("h1,h2,h3,[role='heading']"),
  ).find((node) => isStockHeading(textOf(node)));
  const text = textOf(heading ?? null);
  if (text.startsWith("แก้ไขสินค้า:")) return text.slice("แก้ไขสินค้า:".length).trim();
  if (text.startsWith("Edit Product:")) return text.slice("Edit Product:".length).trim();
  return "";
}

function apiErrorMessage(body: ApiBody<unknown>, fallback: string) {
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object") {
    const error = body.error as { message?: unknown; code?: unknown };
    if (typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error.code === "string" && error.code.trim()) return error.code;
  }
  return fallback;
}

function isFeatureDisabled(response: Response, body: ApiBody<unknown>) {
  if (response.status !== 403) return false;
  if (body.error === "feature_not_enabled") return true;
  if (body.error && typeof body.error === "object") {
    return (body.error as { code?: unknown }).code === "feature_not_enabled";
  }
  return false;
}

function appendText(parent: HTMLElement, text: string, className?: string) {
  const node = document.createElement("span");
  node.textContent = text;
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

function currentBundleFor(state: MutableState) {
  if (!state.modal) return null;
  const editName = productNameFromHeading(state.modal);
  if (!editName) return null;
  const category = String(findCategoryControl(state.modal)?.value ?? "").trim();
  const items = state.bundleView?.items ?? [];
  return (
    items.find(
      (item) =>
        String(item.name ?? "").trim() === editName &&
        (!category || String(item.category ?? "") === category),
    ) ??
    items.find((item) => String(item.name ?? "").trim() === editName) ??
    null
  );
}

function currentNormalProductFor(state: MutableState) {
  if (!state.modal) return null;
  const editName = productNameFromHeading(state.modal);
  if (!editName) return null;
  const category = String(findCategoryControl(state.modal)?.value ?? "").trim();
  const items = state.bundleView?.eligible_items ?? [];
  return (
    items.find(
      (item) =>
        String(item.name ?? "").trim() === editName &&
        (!category || String(item.category ?? "") === category),
    ) ??
    items.find((item) => String(item.name ?? "").trim() === editName) ??
    null
  );
}

function availableProductsFor(state: MutableState) {
  const parent = currentBundleFor(state) ?? currentNormalProductFor(state);
  return (state.bundleView?.eligible_items ?? []).filter((item) => item.id !== parent?.id);
}

export function StockBundleInlineController() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const state: MutableState = {
      modal: null,
      root: null,
      bundleView: null,
      featureAvailable: null,
      enabled: false,
      selection: new Map(),
      searchText: "",
      errorText: "",
      saving: false,
      loadToken: 0,
    };

    const boundSaveButtons = new WeakSet<HTMLButtonElement>();
    let frame = 0;

    const ensureRoot = () => {
      const modal = state.modal;
      if (!modal || state.featureAvailable !== true) return null;
      const ingredientSection = findIngredientSection(modal);
      if (!ingredientSection) return null;

      if (!state.root) {
        state.root = document.createElement("div");
        state.root.id = ROOT_ID;
      }

      if (!state.root.isConnected || !modal.contains(state.root)) {
        ingredientSection.insertAdjacentElement("afterend", state.root);
      } else if (state.root.previousElementSibling !== ingredientSection) {
        ingredientSection.insertAdjacentElement("afterend", state.root);
      }
      return state.root;
    };

    const render = () => {
      const root = ensureRoot();
      if (!root) return;
      root.replaceChildren();
      root.className = "mt-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3";
      root.dataset.cpiposBundleInline = "true";

      const bundle = currentBundleFor(state);
      const products = availableProductsFor(state);
      const query = state.searchText.trim().toLocaleLowerCase();
      const filtered = !query
        ? products
        : products.filter((item) =>
            [item.name, item.sku, item.category]
              .map((value) => String(value ?? "").toLocaleLowerCase())
              .some((value) => value.includes(query)),
          );
      const selectedCount = products.filter((item) => state.selection.get(item.id)?.selected).length;

      const top = document.createElement("div");
      top.className = "flex flex-wrap items-center justify-between gap-2";
      const toggleLabel = document.createElement("label");
      toggleLabel.className =
        "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-sm font-extrabold text-blue-900";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = state.enabled;
      toggle.className = "h-4 w-4 rounded border-blue-300";
      toggle.addEventListener("change", () => {
        if (bundle && !toggle.checked) {
          toggle.checked = true;
          state.errorText =
            "ชุดนี้ถูกบันทึกเป็นสินค้าชุดรวมขายแล้ว สามารถแก้รายการและจำนวนต่อชุดได้จากส่วนนี้";
          render();
          return;
        }
        state.enabled = toggle.checked;
        state.errorText = "";
        render();
      });
      toggleLabel.appendChild(toggle);
      appendText(toggleLabel, "สินค้าชุดรวมขาย");
      top.appendChild(toggleLabel);
      if (state.enabled) appendText(top, `เลือกแล้ว ${selectedCount} รายการ`, "text-xs font-semibold text-blue-700");
      root.appendChild(top);

      const help = document.createElement("p");
      help.className = "mt-1 text-xs text-slate-600";
      help.textContent = "รวมสินค้าที่มีอยู่หลายรายการเป็น 1 ชุดขาย และตัดสต๊อกแต่ละรายการตามจำนวนที่กำหนด";
      root.appendChild(help);

      if (state.enabled) {
        const content = document.createElement("div");
        content.className = "mt-3";

        const searchRow = document.createElement("div");
        searchRow.className = "mb-2 flex flex-wrap items-center gap-2";
        const search = document.createElement("input");
        search.type = "search";
        search.value = state.searchText;
        search.placeholder = "ค้นหาชื่อสินค้า / SKU / หมวดหมู่";
        search.className =
          "min-h-10 min-w-[240px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-blue-200 focus:ring-2";
        search.addEventListener("input", () => {
          state.searchText = search.value;
          render();
          window.requestAnimationFrame(() => {
            const next = state.root?.querySelector<HTMLInputElement>('input[type="search"]');
            next?.focus();
            next?.setSelectionRange(next.value.length, next.value.length);
          });
        });
        searchRow.appendChild(search);
        appendText(searchRow, `ทั้งหมด ${products.length} รายการ`, "text-xs font-semibold text-slate-500");
        content.appendChild(searchRow);

        if (products.length === 0) {
          const empty = document.createElement("p");
          empty.className = "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800";
          empty.textContent = "ยังไม่มีสินค้าที่สามารถนำมารวมเป็นชุดได้";
          content.appendChild(empty);
        } else if (filtered.length === 0) {
          const empty = document.createElement("p");
          empty.className = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600";
          empty.textContent = "ไม่พบสินค้าที่ตรงกับคำค้นหา";
          content.appendChild(empty);
        } else {
          const tableWrap = document.createElement("div");
          tableWrap.className = "max-h-[32vh] overflow-auto rounded-xl border border-slate-200 bg-white";
          const table = document.createElement("table");
          table.className = "w-full min-w-[620px] border-collapse";
          const thead = document.createElement("thead");
          thead.className = "sticky top-0 z-[1] bg-slate-50";
          const headRow = document.createElement("tr");
          for (const title of ["เลือก", "สินค้าในชุด", "SKU", "จำนวนต่อ 1 ชุด"]) {
            const th = document.createElement("th");
            th.className = "border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600";
            th.textContent = title;
            headRow.appendChild(th);
          }
          thead.appendChild(headRow);
          table.appendChild(thead);
          const tbody = document.createElement("tbody");

          for (const item of filtered) {
            const line = state.selection.get(item.id) ?? { selected: false, qty: "1" };
            const row = document.createElement("tr");
            row.className = line.selected ? "bg-blue-50/60" : "bg-white";

            const selectCell = document.createElement("td");
            selectCell.className = "border-b border-slate-100 px-3 py-2";
            const itemCheck = document.createElement("input");
            itemCheck.type = "checkbox";
            itemCheck.checked = line.selected;
            itemCheck.className = "h-4 w-4 rounded border-slate-300";
            itemCheck.setAttribute("aria-label", `เลือก ${item.name ?? item.sku ?? "สินค้า"}`);
            itemCheck.addEventListener("change", () => {
              state.selection.set(item.id, { selected: itemCheck.checked, qty: line.qty || "1" });
              state.errorText = "";
              render();
            });
            selectCell.appendChild(itemCheck);
            row.appendChild(selectCell);

            const nameCell = document.createElement("td");
            nameCell.className = "border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800";
            nameCell.textContent = item.name || "-";
            row.appendChild(nameCell);

            const skuCell = document.createElement("td");
            skuCell.className = "border-b border-slate-100 px-3 py-2 text-xs text-slate-500";
            skuCell.textContent = item.sku || "-";
            row.appendChild(skuCell);

            const qtyCell = document.createElement("td");
            qtyCell.className = "border-b border-slate-100 px-3 py-2";
            const qty = document.createElement("input");
            qty.type = "number";
            qty.min = "0.001";
            qty.step = "0.001";
            qty.value = line.qty;
            qty.disabled = !line.selected;
            qty.className =
              "min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
            qty.addEventListener("input", () => {
              state.selection.set(item.id, { selected: line.selected, qty: qty.value });
              state.errorText = "";
            });
            qtyCell.appendChild(qty);
            row.appendChild(qtyCell);
            tbody.appendChild(row);
          }
          table.appendChild(tbody);
          tableWrap.appendChild(table);
          content.appendChild(tableWrap);
        }

        const rule = document.createElement("p");
        rule.className = "mt-2 text-xs font-medium text-blue-700";
        rule.textContent = "ต้องเลือกอย่างน้อย 2 รายการ และจำนวนของทุกรายการต้องมากกว่า 0";
        content.appendChild(rule);
        root.appendChild(content);
      }

      if (state.errorText) {
        const error = document.createElement("p");
        error.className = "mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700";
        error.textContent = state.errorText;
        root.appendChild(error);
      }
      if (state.saving) {
        const saving = document.createElement("p");
        saving.className = "mt-2 text-sm font-semibold text-blue-700";
        saving.textContent = "กำลังบันทึกสินค้าชุดรวมขาย...";
        root.appendChild(saving);
      }
    };

    const initializeSelection = () => {
      state.selection = new Map();
      for (const item of state.bundleView?.eligible_items ?? []) {
        state.selection.set(item.id, { selected: false, qty: "1" });
      }
      const bundle = currentBundleFor(state);
      if (bundle) {
        for (const item of bundle.bundle_items ?? []) {
          const productId = String(item.product_id ?? "");
          if (!productId) continue;
          state.selection.set(productId, {
            selected: true,
            qty: String(Number(item.qty ?? 1) || 1),
          });
        }
        state.enabled = true;
      } else {
        state.enabled = false;
      }
    };

    const bindSaveButton = () => {
      const modal = state.modal;
      if (!modal) return;
      const button = findSaveButton(modal);
      if (!button || boundSaveButtons.has(button)) return;
      boundSaveButtons.add(button);

      button.addEventListener(
        "click",
        async (event) => {
          if (!state.modal || !state.modal.contains(button)) return;
          if (state.featureAvailable !== true || !state.enabled) return;

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (state.saving) return;

          const modalNow = state.modal;
          const category = String(findCategoryControl(modalNow)?.value ?? "").trim();
          const name = String(findProductNameControl(modalNow)?.value ?? productNameFromHeading(modalNow)).trim();
          const price = Number(findStorePriceControl(modalNow)?.value ?? "");
          const items = availableProductsFor(state)
            .filter((item) => state.selection.get(item.id)?.selected)
            .map((item) => ({
              product_id: item.id,
              qty: Number(state.selection.get(item.id)?.qty ?? 0),
            }))
            .filter((item) => Number.isFinite(item.qty) && item.qty > 0);

          if (!name) {
            state.errorText = "กรุณากรอกชื่อสินค้า";
            render();
            return;
          }
          if (!category) {
            state.errorText = "กรุณาเลือกหมวดหมู่";
            render();
            return;
          }
          if (!Number.isFinite(price) || price < 0) {
            state.errorText = "กรุณากรอกราคาหน้าร้านให้ถูกต้อง";
            render();
            return;
          }
          if (items.length < 2) {
            state.errorText = "สินค้าชุดรวมขายต้องเลือกสินค้าอย่างน้อย 2 รายการ";
            render();
            return;
          }

          state.saving = true;
          state.errorText = "";
          render();
          try {
            const parent = currentBundleFor(state) ?? currentNormalProductFor(state);
            const response = await fetch("/api/backoffice/bundles/popup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "upsert_bundle",
                id: parent?.id,
                sku: parent?.sku,
                name,
                category,
                price,
                items,
              }),
            });
            const body = (await response.json().catch(() => ({}))) as ApiBody<unknown>;
            if (!response.ok || body.error) {
              throw new Error(apiErrorMessage(body, "บันทึกสินค้าชุดรวมขายไม่สำเร็จ"));
            }
            window.location.reload();
          } catch (error) {
            state.saving = false;
            state.errorText = error instanceof Error ? error.message : "บันทึกสินค้าชุดรวมขายไม่สำเร็จ";
            render();
          }
        },
        true,
      );
    };

    const loadBundleView = async (modal: HTMLElement) => {
      const token = ++state.loadToken;
      state.featureAvailable = null;
      state.bundleView = null;
      state.enabled = false;
      state.selection = new Map();
      state.searchText = "";
      state.errorText = "";
      state.saving = false;

      try {
        const response = await fetch("/api/backoffice/bundles", { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as ApiBody<BundleView>;
        if (token !== state.loadToken || state.modal !== modal) return;

        if (isFeatureDisabled(response, body)) {
          state.featureAvailable = false;
          state.root?.remove();
          state.root = null;
          return;
        }
        if (!response.ok || body.error) {
          state.featureAvailable = true;
          state.bundleView = { items: [], eligible_items: [] };
          state.errorText = apiErrorMessage(body, "โหลดรายการสินค้าชุดรวมขายไม่สำเร็จ");
        } else {
          state.featureAvailable = true;
          state.bundleView = body.data ?? { items: [], eligible_items: [] };
        }
        initializeSelection();
        render();
        bindSaveButton();
      } catch (error) {
        if (token !== state.loadToken || state.modal !== modal) return;
        state.featureAvailable = true;
        state.bundleView = { items: [], eligible_items: [] };
        state.errorText = error instanceof Error ? error.message : "โหลดรายการสินค้าชุดรวมขายไม่สำเร็จ";
        initializeSelection();
        render();
        bindSaveButton();
      }
    };

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextModal = findStockProductModal();
        if (nextModal !== state.modal) {
          state.loadToken += 1;
          state.root?.remove();
          state.root = null;
          state.modal = nextModal;
          state.bundleView = null;
          state.featureAvailable = null;
          state.enabled = false;
          state.selection = new Map();
          state.searchText = "";
          state.errorText = "";
          state.saving = false;
          if (nextModal) void loadBundleView(nextModal);
          return;
        }

        if (!state.modal) return;
        if (state.featureAvailable === true) ensureRoot();
        bindSaveButton();
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      state.loadToken += 1;
      state.root?.remove();
      state.root = null;
    };
  }, []);

  return null;
}

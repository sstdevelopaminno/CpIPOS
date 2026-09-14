"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

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
    product?: SaleProduct | null;
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

type SelectionMap = Record<string, { selected: boolean; qty: string }>;

type AnchorPosition = {
  left: number;
  top: number;
  width: number;
};

function textOf(element: Element | null) {
  return String(element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isProductPopupHeading(text: string) {
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
  if (typeof document === "undefined") return null;
  if (!window.location.pathname.startsWith("/preview/pos/stock")) return null;

  const headings = Array.from(
    document.querySelectorAll<HTMLElement>("h1,h2,h3,[role='heading']"),
  );
  const heading = headings.find((node) => isProductPopupHeading(textOf(node)));
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

function findIngredientToggleLabel(modal: HTMLElement) {
  return (
    Array.from(modal.querySelectorAll<HTMLLabelElement>("label")).find((label) => {
      const text = textOf(label);
      return (
        text.includes("เปิดใส่วัตถุดิบ") ||
        text.includes("เปิดโหมดสูตรวัตถุดิบ") ||
        text.includes("Enable ingredient recipe mode")
      );
    }) ?? null
  );
}

function findLabelControl(modal: HTMLElement, labels: string[]) {
  const candidates = Array.from(modal.querySelectorAll<HTMLLabelElement>("label"));
  for (const label of candidates) {
    const labelText = textOf(label);
    if (!labels.some((token) => labelText.includes(token))) continue;
    const control = label.querySelector<HTMLInputElement | HTMLSelectElement>(
      "select,input:not([type='checkbox'])",
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
    modal.querySelector<HTMLInputElement | HTMLSelectElement>('select[name="category"],input[name="category"]')
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
  ).find((node) => isProductPopupHeading(textOf(node)));
  const text = textOf(heading ?? null);
  if (text.startsWith("แก้ไขสินค้า:")) return text.slice("แก้ไขสินค้า:".length).trim();
  if (text.startsWith("Edit Product:")) return text.slice("Edit Product:".length).trim();
  return "";
}

function asPrice(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
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

function sameAnchor(a: AnchorPosition | null, b: AnchorPosition | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.width - b.width) < 1
  );
}

function calculateAnchor(modal: HTMLElement): AnchorPosition | null {
  const ingredientLabel = findIngredientToggleLabel(modal);
  if (!ingredientLabel) return null;

  const modalRect = modal.getBoundingClientRect();
  let anchorRect = ingredientLabel.getBoundingClientRect();
  const row = ingredientLabel.parentElement;

  if (row) {
    const siblingLabels = Array.from(row.querySelectorAll<HTMLLabelElement>("label")).filter((label) => {
      const rect = label.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (siblingLabels.length > 1) {
      anchorRect = siblingLabels[siblingLabels.length - 1].getBoundingClientRect();
    }
  }

  const desiredWidth = 250;
  const rightLimit = Math.max(modalRect.left + desiredWidth, modalRect.right - 12);
  let left = anchorRect.right + 10;
  let top = anchorRect.top;

  if (left + desiredWidth > rightLimit) {
    left = Math.max(modalRect.left + 14, modalRect.right - desiredWidth - 14);
    top = anchorRect.top;
  }

  const width = Math.max(210, Math.min(desiredWidth, modalRect.right - left - 12));
  return { left, top, width };
}

export function StockBundleInlineController() {
  const [modal, setModal] = useState<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<AnchorPosition | null>(null);
  const [bundleView, setBundleView] = useState<BundleView | null>(null);
  const [featureAvailable, setFeatureAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionMap>({});
  const [searchText, setSearchText] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [parentProduct, setParentProduct] = useState<SaleProduct | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = findStockProductModal();
        setModal((current) => (current === next ? current : next));
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", sync);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("popstate", sync);
    };
  }, []);

  useEffect(() => {
    if (!modal) {
      setAnchor(null);
      setBundleView(null);
      setFeatureAvailable(null);
      setEnabled(false);
      setPanelOpen(false);
      setSelection({});
      setSearchText("");
      setErrorText("");
      setParentProduct(null);
      return;
    }

    let frame = 0;
    const updateAnchor = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = calculateAnchor(modal);
        setAnchor((current) => (sameAnchor(current, next) ? current : next));
      });
    };

    updateAnchor();
    const observer = new MutationObserver(updateAnchor);
    observer.observe(modal, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateAnchor) : null;
    resizeObserver?.observe(modal);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
    };
  }, [modal]);

  const loadBundleView = useCallback(async () => {
    if (!modal) return;
    setLoading(true);
    setErrorText("");

    try {
      const response = await fetch("/api/backoffice/bundles", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ApiBody<BundleView>;

      if (isFeatureDisabled(response, body)) {
        setFeatureAvailable(false);
        setBundleView(null);
        setEnabled(false);
        setPanelOpen(false);
        return;
      }

      if (!response.ok || body.error) {
        setFeatureAvailable(true);
        throw new Error(apiErrorMessage(body, "โหลดรายการชุดรวมขายไม่สำเร็จ"));
      }

      const view = body.data ?? { items: [], eligible_items: [] };
      setBundleView(view);
      setFeatureAvailable(true);

      const editName = productNameFromHeading(modal);
      const category = String(findCategoryControl(modal)?.value ?? "").trim();
      const currentBundle = editName
        ? (view.items ?? []).find(
            (item) =>
              String(item.name ?? "").trim() === editName &&
              (!category || String(item.category ?? "").trim() === category),
          ) ?? (view.items ?? []).find((item) => String(item.name ?? "").trim() === editName) ?? null
        : null;
      const currentNormal = editName
        ? (view.eligible_items ?? []).find(
            (item) =>
              String(item.name ?? "").trim() === editName &&
              (!category || String(item.category ?? "").trim() === category),
          ) ?? (view.eligible_items ?? []).find((item) => String(item.name ?? "").trim() === editName) ?? null
        : null;

      const nextSelection: SelectionMap = {};
      for (const item of view.eligible_items ?? []) {
        nextSelection[item.id] = { selected: false, qty: "1" };
      }
      for (const item of currentBundle?.bundle_items ?? []) {
        const productId = String(item.product_id ?? "");
        if (!productId) continue;
        nextSelection[productId] = {
          selected: true,
          qty: String(Number(item.qty ?? 1) || 1),
        };
      }

      setParentProduct(currentBundle ?? currentNormal ?? null);
      setSelection(nextSelection);
      setEnabled(Boolean(currentBundle));
      setPanelOpen(false);
    } catch (error) {
      setFeatureAvailable((current) => current ?? true);
      setBundleView({ items: [], eligible_items: [] });
      setErrorText(error instanceof Error ? error.message : "โหลดรายการชุดรวมขายไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [modal]);

  useEffect(() => {
    if (!modal) return;
    void loadBundleView();
  }, [modal, loadBundleView]);

  const availableProducts = useMemo(() => {
    const parentId = parentProduct?.id ?? "";
    return (bundleView?.eligible_items ?? []).filter((item) => item.id !== parentId);
  }, [bundleView, parentProduct]);

  const filteredProducts = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    if (!query) return availableProducts;
    return availableProducts.filter((item) =>
      [item.name, item.sku, item.category]
        .map((value) => String(value ?? "").toLocaleLowerCase())
        .some((value) => value.includes(query)),
    );
  }, [availableProducts, searchText]);

  const selectedCount = useMemo(
    () => availableProducts.filter((item) => selection[item.id]?.selected).length,
    [availableProducts, selection],
  );

  useEffect(() => {
    if (!modal || featureAvailable !== true) return;
    const saveButton = findSaveButton(modal);
    if (!saveButton) return;

    const onSave = async (event: Event) => {
      if (!enabled) return;
      event.preventDefault();
      event.stopPropagation();
      if ("stopImmediatePropagation" in event) event.stopImmediatePropagation();
      if (saving) return;

      const nameControl = findProductNameControl(modal);
      const categoryControl = findCategoryControl(modal);
      const priceControl = findStorePriceControl(modal);
      const editName = productNameFromHeading(modal);
      const name = String(nameControl?.value ?? editName).trim();
      const category = String(categoryControl?.value ?? "").trim();
      const price = asPrice(String(priceControl?.value ?? ""));
      const items = availableProducts
        .filter((item) => selection[item.id]?.selected)
        .map((item) => ({
          product_id: item.id,
          qty: Number(selection[item.id]?.qty ?? 0),
        }))
        .filter((item) => Number.isFinite(item.qty) && item.qty > 0);

      if (!name) {
        setErrorText("กรุณากรอกชื่อสินค้า");
        setPanelOpen(true);
        return;
      }
      if (!category) {
        setErrorText("กรุณาเลือกหมวดหมู่");
        setPanelOpen(true);
        return;
      }
      if (price === null) {
        setErrorText("กรุณากรอกราคาหน้าร้านให้ถูกต้อง");
        setPanelOpen(true);
        return;
      }
      if (items.length < 2) {
        setErrorText("สินค้าชุดรวมขายต้องเลือกสินค้าอย่างน้อย 2 รายการ");
        setPanelOpen(true);
        return;
      }

      setSaving(true);
      setErrorText("");
      try {
        const response = await fetch("/api/backoffice/bundles/popup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upsert_bundle",
            id: parentProduct?.id,
            sku: parentProduct?.sku,
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
        setErrorText(error instanceof Error ? error.message : "บันทึกสินค้าชุดรวมขายไม่สำเร็จ");
        setPanelOpen(true);
        setSaving(false);
      }
    };

    saveButton.addEventListener("click", onSave, true);
    return () => saveButton.removeEventListener("click", onSave, true);
  }, [
    modal,
    featureAvailable,
    enabled,
    saving,
    availableProducts,
    selection,
    parentProduct,
  ]);

  if (
    typeof document === "undefined" ||
    !modal ||
    featureAvailable !== true ||
    !anchor
  ) {
    return null;
  }

  return createPortal(
    <>
      <div
        data-cpipos-bundle-anchor="true"
        style={{
          position: "fixed",
          left: anchor.left,
          top: anchor.top,
          width: anchor.width,
          zIndex: 176,
        }}
        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 shadow-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm font-bold text-blue-900">
            <input
              type="checkbox"
              checked={enabled}
              disabled={loading || saving}
              onChange={(event) => {
                const checked = event.target.checked;
                setEnabled(checked);
                setErrorText("");
                if (checked) setPanelOpen(true);
                else setPanelOpen(false);
              }}
              className="h-4 w-4 rounded border-blue-300"
            />
            <span>สินค้าชุดรวมขาย</span>
          </label>
          {enabled ? (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
            >
              เลือกสินค้า ({selectedCount})
            </button>
          ) : null}
        </div>
        {errorText ? (
          <p className="mt-1 text-[11px] font-semibold leading-4 text-red-600">{errorText}</p>
        ) : null}
      </div>

      {panelOpen && enabled ? (
        <div
          className="fixed inset-0 z-[190] grid place-items-center bg-slate-950/35 p-4"
          onClick={() => !saving && setPanelOpen(false)}
        >
          <section
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-lg font-black text-slate-950">เลือกสินค้าในชุดรวมขาย</h3>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  เลือกสินค้าที่มีอยู่ในร้านและระบุจำนวนที่ใช้ต่อการขาย 1 ชุด
                </p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setPanelOpen(false)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                ปิด
              </button>
            </header>

            <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="ค้นหาชื่อสินค้า / SKU / หมวดหมู่"
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-blue-200 focus:ring-2"
              />
              <span className="text-sm font-bold text-blue-700">เลือกแล้ว {selectedCount} รายการ</span>
            </div>

            {errorText ? (
              <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
                {errorText}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-black text-slate-600">เลือก</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-black text-slate-600">สินค้าในชุด</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-black text-slate-600">SKU</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-black text-slate-600">หมวดหมู่</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-black text-slate-600">จำนวนต่อ 1 ชุด</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length > 0 ? (
                    filteredProducts.map((item) => {
                      const line = selection[item.id] ?? { selected: false, qty: "1" };
                      return (
                        <tr key={item.id} className={line.selected ? "bg-blue-50/60" : "bg-white"}>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={line.selected}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setSelection((current) => ({
                                  ...current,
                                  [item.id]: {
                                    selected: checked,
                                    qty: current[item.id]?.qty || "1",
                                  },
                                }));
                                setErrorText("");
                              }}
                              className="h-4 w-4 rounded border-blue-300"
                            />
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2 text-sm font-bold text-slate-900">
                            {item.name || "-"}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-600">{item.sku || "-"}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-600">{item.category || "-"}</td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <input
                              type="number"
                              min={0.01}
                              step="0.01"
                              disabled={!line.selected}
                              value={line.qty}
                              onChange={(event) => {
                                const qty = event.target.value;
                                setSelection((current) => ({
                                  ...current,
                                  [item.id]: {
                                    selected: current[item.id]?.selected ?? false,
                                    qty,
                                  },
                                }));
                                setErrorText("");
                              }}
                              className="min-h-9 w-32 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                            />
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                        ไม่พบสินค้าที่ตรงกับการค้นหา
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium text-slate-500">
                เมื่อกดบันทึกสินค้า ระบบจะบันทึกเป็นสินค้าชุดรวมขายและตัดสต๊อกจากรายการที่เลือกตามจำนวนต่อ 1 ชุด
              </p>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                เสร็จสิ้น
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>,
    document.body,
  );
}

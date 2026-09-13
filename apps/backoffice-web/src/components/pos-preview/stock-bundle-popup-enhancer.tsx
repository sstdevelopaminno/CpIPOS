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

type ApiEnvelope<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

type SelectionMap = Record<string, { selected: boolean; qty: string }>;

const HOST_ID = "cpipos-stock-bundle-popup-controls";

function textOf(element: Element | null) {
  return String(element?.textContent ?? "").trim();
}

function findStockProductModal() {
  const headings = Array.from(document.querySelectorAll("h1,h2,h3"));
  const heading = headings.find((node) => {
    const text = textOf(node);
    return (
      text.includes("จัดการสินค้าและสต๊อก") ||
      text.includes("Manage Catalog & Stock") ||
      text.startsWith("แก้ไขสินค้า:") ||
      text.startsWith("Edit Product:")
    );
  });
  if (!heading) return null;

  let node: HTMLElement | null = heading.parentElement;
  while (node && node !== document.body) {
    const hasSaveButton = Array.from(node.querySelectorAll("button")).some((button) => {
      const text = textOf(button);
      return text.startsWith("บันทึกสินค้า") || text.startsWith("บันทึกการเปลี่ยนแปลง") || text.startsWith("Save Product") || text.startsWith("Save Changes");
    });
    if (hasSaveButton) return node;
    node = node.parentElement;
  }
  return null;
}

function findSaveButton(modal: HTMLElement) {
  return Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
    const text = textOf(button);
    return text.startsWith("บันทึกสินค้า") || text.startsWith("บันทึกการเปลี่ยนแปลง") || text.startsWith("Save Product") || text.startsWith("Save Changes");
  }) ?? null;
}

function findLabelControl(modal: HTMLElement, labels: string[]) {
  const candidates = Array.from(modal.querySelectorAll<HTMLLabelElement>("label"));
  for (const label of candidates) {
    const labelText = textOf(label.querySelector("span"));
    if (!labels.some((token) => labelText.includes(token))) continue;
    const control = label.querySelector<HTMLInputElement | HTMLSelectElement>("input:not([type='checkbox']),select");
    if (control) return control;
  }
  return null;
}

function productNameFromHeading(modal: HTMLElement) {
  const heading = textOf(modal.querySelector("h1,h2,h3"));
  if (heading.startsWith("แก้ไขสินค้า:")) return heading.slice("แก้ไขสินค้า:".length).trim();
  if (heading.startsWith("Edit Product:")) return heading.slice("Edit Product:".length).trim();
  return "";
}

function directChildContaining(modal: HTMLElement, descendant: HTMLElement) {
  let node: HTMLElement = descendant;
  while (node.parentElement && node.parentElement !== modal) node = node.parentElement;
  return node;
}

function asPrice(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function StockBundlePopupEnhancer() {
  const [modal, setModal] = useState<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [domVersion, setDomVersion] = useState(0);
  const [bundleView, setBundleView] = useState<BundleView | null>(null);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<SelectionMap>({});
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [loadedModalKey, setLoadedModalKey] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = findStockProductModal();
        setModal((current) => (current === next ? current : next));
        setDomVersion((value) => value + 1);
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!modal) {
      setHost(null);
      setLoadedModalKey("");
      return;
    }

    const existing = modal.querySelector<HTMLElement>(`#${HOST_ID}`);
    const element = existing ?? document.createElement("div");
    element.id = HOST_ID;

    if (!existing) {
      const saveButton = findSaveButton(modal);
      if (saveButton) {
        const footer = directChildContaining(modal, saveButton);
        modal.insertBefore(element, footer);
      } else {
        modal.appendChild(element);
      }
    }
    setHost(element);

    return () => {
      if (element.isConnected) element.remove();
      setHost(null);
    };
  }, [modal]);

  const loadBundleView = useCallback(async () => {
    if (!modal) return;
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetch("/api/backoffice/bundles", { cache: "no-store" });
      const body = (await response.json()) as ApiEnvelope<BundleView>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "โหลดรายการชุดรวมขายไม่สำเร็จ");
      }
      setBundleView(body.data ?? { items: [], eligible_items: [] });
    } catch (error) {
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

  const modalKey = useMemo(() => {
    if (!modal) return "";
    const name = productNameFromHeading(modal);
    return name ? `edit:${name}` : "add";
  }, [modal, domVersion]);

  const categoryControl = modal ? findLabelControl(modal, ["หมวดหมู่", "Category"]) : null;
  const currentCategory = String(categoryControl?.value ?? "").trim();
  const editProductName = modal ? productNameFromHeading(modal) : "";

  const currentBundle = useMemo(() => {
    if (!editProductName) return null;
    const items = bundleView?.items ?? [];
    return items.find((item) => String(item.name ?? "").trim() === editProductName && (!currentCategory || String(item.category ?? "") === currentCategory))
      ?? items.find((item) => String(item.name ?? "").trim() === editProductName)
      ?? null;
  }, [bundleView, editProductName, currentCategory]);

  const currentNormalProduct = useMemo(() => {
    if (!editProductName) return null;
    const items = bundleView?.eligible_items ?? [];
    return items.find((item) => String(item.name ?? "").trim() === editProductName && (!currentCategory || String(item.category ?? "") === currentCategory))
      ?? items.find((item) => String(item.name ?? "").trim() === editProductName)
      ?? null;
  }, [bundleView, editProductName, currentCategory]);

  useEffect(() => {
    if (!modalKey || !bundleView || loadedModalKey === modalKey) return;

    if (currentBundle) {
      const next: SelectionMap = {};
      for (const item of bundleView.eligible_items ?? []) {
        next[item.id] = { selected: false, qty: "1" };
      }
      for (const item of currentBundle.bundle_items ?? []) {
        const productId = String(item.product_id ?? "");
        if (!productId) continue;
        next[productId] = { selected: true, qty: String(Number(item.qty ?? 1) || 1) };
      }
      setSelection(next);
      setEnabled(true);
    } else {
      const next: SelectionMap = {};
      for (const item of bundleView.eligible_items ?? []) {
        next[item.id] = { selected: false, qty: "1" };
      }
      setSelection(next);
      setEnabled(false);
    }
    setErrorText("");
    setLoadedModalKey(modalKey);
  }, [bundleView, currentBundle, loadedModalKey, modalKey]);

  const availableProducts = useMemo(() => {
    const parentId = currentBundle?.id ?? currentNormalProduct?.id ?? "";
    return (bundleView?.eligible_items ?? []).filter((item) => item.id !== parentId);
  }, [bundleView, currentBundle, currentNormalProduct]);

  const selectedCount = useMemo(
    () => availableProducts.filter((item) => selection[item.id]?.selected).length,
    [availableProducts, selection],
  );

  useEffect(() => {
    if (!modal) return;
    const saveButton = findSaveButton(modal);
    if (!saveButton) return;

    const onSave = async (event: Event) => {
      if (!enabled) return;

      event.preventDefault();
      event.stopPropagation();
      if ("stopImmediatePropagation" in event) event.stopImmediatePropagation();
      if (saving) return;

      const nameControl = findLabelControl(modal, ["ชื่อสินค้า", "Product Name"]);
      const priceControl = findLabelControl(modal, ["ราคาหน้าร้าน", "Store Price"]);
      const category = String(findLabelControl(modal, ["หมวดหมู่", "Category"])?.value ?? "").trim();
      const name = String(nameControl?.value ?? editProductName).trim();
      const price = asPrice(String(priceControl?.value ?? ""));
      const items = availableProducts
        .filter((item) => selection[item.id]?.selected)
        .map((item) => ({ product_id: item.id, qty: Number(selection[item.id]?.qty ?? 0) }))
        .filter((item) => Number.isFinite(item.qty) && item.qty > 0);

      if (!name) {
        setErrorText("กรุณากรอกชื่อสินค้า");
        return;
      }
      if (!category) {
        setErrorText("กรุณาเลือกหมวดหมู่");
        return;
      }
      if (price === null) {
        setErrorText("กรุณากรอกราคาหน้าร้านให้ถูกต้อง");
        return;
      }
      if (items.length < 2) {
        setErrorText("ชุดรวมขายต้องเลือกสินค้าอย่างน้อย 2 รายการ");
        return;
      }

      setSaving(true);
      setErrorText("");
      try {
        const parent = currentBundle ?? currentNormalProduct;
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
        const body = (await response.json()) as ApiEnvelope<unknown>;
        if (!response.ok || body.error) {
          throw new Error(body.error?.message ?? "บันทึกชุดรวมขายไม่สำเร็จ");
        }
        window.location.reload();
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "บันทึกชุดรวมขายไม่สำเร็จ");
        setSaving(false);
      }
    };

    saveButton.addEventListener("click", onSave, true);
    return () => saveButton.removeEventListener("click", onSave, true);
  }, [modal, enabled, saving, editProductName, availableProducts, selection, currentBundle, currentNormalProduct]);

  if (!modal || !host) return null;

  const productNameControl = findLabelControl(modal, ["ชื่อสินค้า", "Product Name"]);
  if (!productNameControl) return null;

  return createPortal(
    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3" data-cpipos-bundle-popup="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-sm font-extrabold text-blue-900">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              if (currentBundle && !event.target.checked) {
                setErrorText("ชุดนี้ถูกบันทึกเป็นชุดรวมขายแล้ว สามารถแก้รายการและจำนวนต่อชุดได้จากส่วนนี้");
                return;
              }
              setEnabled(event.target.checked);
              setErrorText("");
            }}
            className="h-4 w-4 rounded border-blue-300"
          />
          <span>ชุดรวมขาย</span>
        </label>
        {enabled ? <span className="text-xs font-semibold text-blue-700">เลือกแล้ว {selectedCount} รายการ</span> : null}
      </div>

      <p className="mt-1 text-xs text-slate-600">
        เปิดเพื่อขายสินค้าหลายรายการเป็น 1 ชุด ระบบจะหักสต๊อกของสินค้าในชุดตามจำนวนที่กำหนดต่อ 1 ชุด
      </p>

      {enabled ? (
        <div className="mt-3">
          {loading ? <p className="text-sm text-slate-500">กำลังโหลดรายการสินค้า...</p> : null}
          {!loading && availableProducts.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              ยังไม่มีสินค้าที่สามารถนำมารวมเป็นชุดได้
            </p>
          ) : null}
          {!loading && availableProducts.length > 0 ? (
            <div className="max-h-[30vh] overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[620px] border-collapse">
                <thead className="sticky top-0 z-[1] bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">เลือก</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">สินค้าในชุด</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">SKU</th>
                    <th className="w-44 border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">จำนวนต่อ 1 ชุด</th>
                  </tr>
                </thead>
                <tbody>
                  {availableProducts.map((item) => {
                    const line = selection[item.id] ?? { selected: false, qty: "1" };
                    return (
                      <tr key={item.id} className={line.selected ? "bg-blue-50/60" : "bg-white"}>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={line.selected}
                            onChange={(event) => {
                              setSelection((current) => ({
                                ...current,
                                [item.id]: { selected: event.target.checked, qty: current[item.id]?.qty || "1" },
                              }));
                              setErrorText("");
                            }}
                            className="h-4 w-4 rounded border-slate-300"
                            aria-label={`เลือก ${item.name ?? item.sku ?? "สินค้า"}`}
                          />
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">{item.name || "-"}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">{item.sku || "-"}</td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={line.qty}
                            disabled={!line.selected}
                            onChange={(event) => {
                              const value = event.target.value;
                              setSelection((current) => ({
                                ...current,
                                [item.id]: { selected: current[item.id]?.selected ?? false, qty: value },
                              }));
                              setErrorText("");
                            }}
                            className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            aria-label={`จำนวน ${item.name ?? item.sku ?? "สินค้า"} ต่อหนึ่งชุด`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="mt-2 text-xs font-medium text-blue-700">ต้องเลือกอย่างน้อย 2 รายการ และจำนวนของทุกรายการต้องมากกว่า 0</p>
        </div>
      ) : null}

      {errorText ? (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{errorText}</p>
      ) : null}
      {saving ? <p className="mt-2 text-sm font-semibold text-blue-700">กำลังบันทึกชุดรวมขาย...</p> : null}
    </div>,
    host,
  );
}

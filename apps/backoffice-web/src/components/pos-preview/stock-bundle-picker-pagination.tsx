"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const PAGE_SIZE = 10;

function textOf(element: Element | null) {
  return String(element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function findBundlePickerPanel(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const heading = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,[role='heading']")).find((node) => {
    const text = textOf(node);
    return text === "เลือกสินค้าในชุดรวมขาย" || text === "Select bundle products";
  });
  if (!heading) return null;
  return heading.closest<HTMLElement>("section") ?? null;
}

function findRows(panel: HTMLElement) {
  const tbody = panel.querySelector<HTMLTableSectionElement>("table tbody");
  if (!tbody) return [];
  return Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
}

function isEmptyStateRow(row: HTMLTableRowElement) {
  return Boolean(row.querySelector("td[colspan]"));
}

export function StockBundlePickerPagination() {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame = 0;
    const syncPanel = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextPanel = findBundlePickerPanel();
        setPanel((current) => (current === nextPanel ? current : nextPanel));
      });
    };

    syncPanel();
    const observer = new MutationObserver(syncPanel);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setPage(1);
    if (!panel) {
      setHost(null);
      setRowCount(0);
      return;
    }

    const table = panel.querySelector<HTMLTableElement>("table");
    const scrollContainer = table?.parentElement as HTMLElement | null;
    if (scrollContainer) {
      scrollContainer.style.maxHeight = "48vh";
      scrollContainer.style.overflowY = "auto";
      scrollContainer.style.overscrollBehavior = "contain";
      scrollContainer.style.scrollBehavior = "smooth";
    }

    const footer = panel.querySelector<HTMLElement>("footer");
    if (!footer) return;

    let paginationHost = footer.querySelector<HTMLElement>("[data-cpipos-bundle-pagination-host='true']");
    if (!paginationHost) {
      paginationHost = document.createElement("div");
      paginationHost.dataset.cpiposBundlePaginationHost = "true";
      paginationHost.className = "flex flex-1 items-center justify-end";
      const doneButton = footer.querySelector("button");
      footer.insertBefore(paginationHost, doneButton ?? null);
    }
    setHost(paginationHost);

    const syncRows = () => {
      const rows = findRows(panel);
      const dataRows = rows.filter((row) => !isEmptyStateRow(row));
      setRowCount(dataRows.length);
      if (dataRows.length === 0) setPage(1);
    };

    syncRows();
    const observer = new MutationObserver(() => {
      if (!paginationHost?.isConnected) {
        const nextFooter = panel.querySelector<HTMLElement>("footer");
        const doneButton = nextFooter?.querySelector("button") ?? null;
        if (nextFooter && paginationHost) nextFooter.insertBefore(paginationHost, doneButton);
      }
      syncRows();
    });
    observer.observe(panel, { childList: true, subtree: true });

    const searchInput = panel.querySelector<HTMLInputElement>('input[placeholder*="ค้นหาชื่อสินค้า"],input[placeholder*="Search"]');
    const resetPage = () => setPage(1);
    searchInput?.addEventListener("input", resetPage);

    return () => {
      observer.disconnect();
      searchInput?.removeEventListener("input", resetPage);
      paginationHost?.remove();
      setHost(null);
    };
  }, [panel]);

  const totalPages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (!panel) return;
    if (page > totalPages) {
      setPage(totalPages);
      return;
    }

    const rows = findRows(panel);
    const dataRows = rows.filter((row) => !isEmptyStateRow(row));
    const start = (safePage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    dataRows.forEach((row, index) => {
      row.style.display = index >= start && index < end ? "" : "none";
    });

    const table = panel.querySelector<HTMLTableElement>("table");
    table?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });

    return () => {
      dataRows.forEach((row) => {
        row.style.display = "";
      });
    };
  }, [panel, rowCount, safePage, page, totalPages]);

  const range = useMemo(() => {
    if (rowCount === 0) return { start: 0, end: 0 };
    const start = (safePage - 1) * PAGE_SIZE + 1;
    return { start, end: Math.min(rowCount, safePage * PAGE_SIZE) };
  }, [rowCount, safePage]);

  if (!host || rowCount <= PAGE_SIZE) return null;

  return createPortal(
    <div className="mr-3 flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs font-semibold text-slate-500">
        {range.start}-{range.end} จาก {rowCount} รายการ · หน้า {safePage}/{totalPages}
      </span>
      <button
        type="button"
        disabled={safePage <= 1}
        onClick={() => setPage((current) => Math.max(1, current - 1))}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ก่อนหน้า
      </button>
      <button
        type="button"
        disabled={safePage >= totalPages}
        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
        className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ถัดไป
      </button>
    </div>,
    host,
  );
}

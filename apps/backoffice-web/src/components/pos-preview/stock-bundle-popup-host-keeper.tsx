"use client";

import { useEffect } from "react";

const HOST_ID = "cpipos-stock-bundle-popup-controls";

function textOf(element: Element | null) {
  return String(element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isBundleHeading(text: string) {
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
  const heading = headings.find((node) => isBundleHeading(textOf(node)));
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
  let node: HTMLElement = descendant;
  while (node.parentElement && node.parentElement !== modal) node = node.parentElement;
  return node;
}

function attachHost(modal: HTMLElement, host: HTMLElement) {
  if (host.isConnected && modal.contains(host)) return;
  const saveButton = findSaveButton(modal);
  if (saveButton) {
    const footer = directChildContaining(modal, saveButton);
    modal.insertBefore(host, footer);
    return;
  }
  modal.appendChild(host);
}

/**
 * Keeps the Bundle Products portal target attached to the live Add/Edit product popup.
 * The popup is controlled by React and can replace DOM children after the enhancer
 * inserts its portal host. Re-attaching the exact same host node preserves the portal
 * React tree and prevents Bundle controls from disappearing after a popup re-render.
 */
export function StockBundlePopupHostKeeper() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let rememberedHost: HTMLElement | null = null;
    let frame = 0;

    const repair = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = document.getElementById(HOST_ID) as HTMLElement | null;
        if (current) rememberedHost = current;

        const modal = findStockProductModal();
        if (!modal || !rememberedHost) return;
        attachHost(modal, rememberedHost);
      });
    };

    repair();
    const observer = new MutationObserver(repair);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}

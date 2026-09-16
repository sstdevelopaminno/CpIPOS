"use client";

import { useEffect } from "react";
import { DEFAULT_POS_SALES_MODES, normalizePosSalesModes, posUiModeToControlKey, type PosSalesModeSettings } from "@/lib/pos-sales-modes";

const MODE_ATTRIBUTE = "data-pos-sale-mode";
const LOCK_ATTRIBUTE = "data-it-sales-mode-locked";
const BADGE_ATTRIBUTE = "data-it-sales-mode-lock-badge";
const STYLE_ID = "cpipos-it-sales-mode-policy-style";
const POLICY_REFRESH_MS = 60_000;

type FeaturesEnvelope = {
  data?: {
    sales_modes?: unknown;
  } | null;
};

function ensurePolicyStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [${LOCK_ATTRIBUTE}="1"] {
      position: relative !important;
      cursor: not-allowed !important;
      opacity: .56 !important;
      filter: grayscale(.28) !important;
      box-shadow: none !important;
    }
    [${LOCK_ATTRIBUTE}="1"]::after {
      content: "";
      position: absolute;
      inset: 0;
      border: 1px dashed #f59e0b;
      border-radius: inherit;
      pointer-events: none;
    }
    [${BADGE_ATTRIBUTE}="1"] {
      position: absolute;
      right: 10px;
      bottom: 9px;
      z-index: 3;
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 4px 8px;
      border: 1px solid #fed7aa;
      border-radius: 999px;
      background: #fff7ed;
      color: #c2410c;
      font-size: 10px;
      font-weight: 900;
      line-height: 1;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function lockedLabel() {
  return document.documentElement.lang.toLowerCase().startsWith("en") ? "Locked by IT" : "ปิดโดย IT";
}

function restoreButtonState(element: HTMLElement) {
  if (element instanceof HTMLButtonElement && element.dataset.itSalesModeOriginalDisabled !== undefined) {
    element.disabled = element.dataset.itSalesModeOriginalDisabled === "1";
    delete element.dataset.itSalesModeOriginalDisabled;
  }
}

function setElementLocked(element: HTMLElement, locked: boolean) {
  const badge = element.querySelector<HTMLElement>(`[${BADGE_ATTRIBUTE}="1"]`);

  if (!locked) {
    element.removeAttribute(LOCK_ATTRIBUTE);
    element.removeAttribute("aria-disabled");
    element.removeAttribute("data-it-sales-mode-lock-key");
    restoreButtonState(element);
    badge?.remove();
    return;
  }

  if (element instanceof HTMLButtonElement) {
    if (element.dataset.itSalesModeOriginalDisabled === undefined) {
      element.dataset.itSalesModeOriginalDisabled = element.disabled ? "1" : "0";
    }
    element.disabled = true;
  }

  element.setAttribute(LOCK_ATTRIBUTE, "1");
  element.setAttribute("aria-disabled", "true");
  element.title = lockedLabel();

  if (!badge) {
    const nextBadge = document.createElement("span");
    nextBadge.setAttribute(BADGE_ATTRIBUTE, "1");
    nextBadge.textContent = lockedLabel();
    element.appendChild(nextBadge);
  } else {
    badge.textContent = lockedLabel();
  }
}

export function PosSalesModePolicyController() {
  useEffect(() => {
    let destroyed = false;
    let modes: PosSalesModeSettings = { ...DEFAULT_POS_SALES_MODES };
    let requestSequence = 0;
    let applyFrame: number | null = null;

    ensurePolicyStyles();

    const applyPolicy = () => {
      if (destroyed) return;
      document.querySelectorAll<HTMLElement>(`[${MODE_ATTRIBUTE}]`).forEach((element) => {
        const key = posUiModeToControlKey(element.getAttribute(MODE_ATTRIBUTE));
        if (!key) return;
        element.setAttribute("data-it-sales-mode-lock-key", key);
        setElementLocked(element, modes[key] === false);
      });
    };

    const scheduleApplyPolicy = () => {
      if (destroyed || document.hidden || applyFrame !== null) return;
      applyFrame = window.requestAnimationFrame(() => {
        applyFrame = null;
        applyPolicy();
      });
    };

    const requestPolicy = async () => {
      const sequence = ++requestSequence;
      try {
        const response = await fetch("/api/pos/features", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as FeaturesEnvelope | null;
        if (destroyed || sequence !== requestSequence) return;
        modes = normalizePosSalesModes(payload?.data?.sales_modes);
        scheduleApplyPolicy();
      } catch {
        // Keep the last known policy. Temporary network problems must not rewrite the UI policy.
      }
    };

    const onClickCapture = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${MODE_ATTRIBUTE}]`) : null;
      if (!target) return;
      const key = posUiModeToControlKey(target.getAttribute(MODE_ATTRIBUTE));
      if (!key || modes[key] !== false) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setElementLocked(target, true);
    };

    // React can generate several DOM mutations for one user action. Coalesce them
    // into a single animation-frame policy pass instead of querying the whole DOM
    // once per mutation.
    const observer = new MutationObserver(() => scheduleApplyPolicy());
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", onClickCapture, true);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        scheduleApplyPolicy();
        void requestPolicy();
      }
    };
    const onFocus = () => void requestPolicy();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    void requestPolicy();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void requestPolicy();
    }, POLICY_REFRESH_MS);

    return () => {
      destroyed = true;
      window.clearInterval(intervalId);
      if (applyFrame !== null) window.cancelAnimationFrame(applyFrame);
      observer.disconnect();
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      document.querySelectorAll<HTMLElement>(`[${LOCK_ATTRIBUTE}="1"]`).forEach((element) => setElementLocked(element, false));
    };
  }, []);

  return null;
}

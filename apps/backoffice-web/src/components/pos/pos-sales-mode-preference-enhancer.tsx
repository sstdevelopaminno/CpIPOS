"use client";

import { useEffect } from "react";
import { fetchCurrentProductProfile, readCachedProductProfile } from "@/lib/pos-product-profile-client";
import type { ProductProfileCode } from "@/lib/product-profile-policy";
import {
  DEFAULT_POS_SALES_MODE_ORDER,
  buildPosSalesModeOrderStorageKey,
  getHiddenPosSalesModes,
  normalizePosSalesModeOrder,
  parsePosScopeIdentity,
  swapPosSalesModes,
  type PosSalesMode,
  type PosScopeIdentity
} from "@/lib/pos-sales-mode-preferences";

type Lang = "th" | "en";
type StatusTone = "info" | "error";

type BranchSalesModeOrderApiData = {
  order: PosSalesMode[];
  configured: boolean;
  can_manage: boolean;
  updated_at: string | null;
};

const POS_SCOPE_KEY = "pos_scope_v001";
const SALES_MODE_ORDER_API = "/api/pos/settings/sales-mode-order";
const SELECTOR_QUERY = ".posui-mode-selector";
const GRID_QUERY = ".posui-mode-selector__grid";
const HEADER_QUERY = ".posui-mode-selector__header";
const CLOSE_QUERY = ".posui-mode-selector__close";
const ENHANCED_ATTRIBUTE = "data-pos-mode-preferences-enhanced";
const MODE_ATTRIBUTE = "data-pos-sale-mode";
const HIDDEN_ATTRIBUTE = "data-pos-mode-hidden";
const RANK_ATTRIBUTE = "data-pos-mode-rank";
const SOURCE_ATTRIBUTE = "data-pos-mode-order-source";

function readStoredModeOrder(scope: PosScopeIdentity): PosSalesMode[] {
  try {
    const raw = window.localStorage.getItem(buildPosSalesModeOrderStorageKey(scope));
    if (!raw) return [...DEFAULT_POS_SALES_MODE_ORDER];
    return normalizePosSalesModeOrder(JSON.parse(raw));
  } catch {
    return [...DEFAULT_POS_SALES_MODE_ORDER];
  }
}

function writeStoredModeOrder(scope: PosScopeIdentity, order: PosSalesMode[]) {
  try {
    window.localStorage.setItem(buildPosSalesModeOrderStorageKey(scope), JSON.stringify(normalizePosSalesModeOrder(order)));
  } catch {
    // Cache persistence is optional. The branch-level server preference remains authoritative.
  }
}

function readCurrentScope(): PosScopeIdentity | null {
  try {
    return parsePosScopeIdentity(window.localStorage.getItem(POS_SCOPE_KEY));
  } catch {
    return null;
  }
}

function isPosSalesMode(value: string | null | undefined): value is PosSalesMode {
  return DEFAULT_POS_SALES_MODE_ORDER.includes(value as PosSalesMode);
}

function parseApiData(payload: unknown): BranchSalesModeOrderApiData | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const envelope = payload as { data?: unknown };
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return null;
  const data = envelope.data as Record<string, unknown>;
  return {
    order: normalizePosSalesModeOrder(data.order),
    configured: data.configured === true,
    can_manage: data.can_manage === true,
    updated_at: typeof data.updated_at === "string" ? data.updated_at : null
  };
}

function parseApiError(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const envelope = payload as { error?: unknown };
  if (!envelope.error || typeof envelope.error !== "object" || Array.isArray(envelope.error)) return "";
  const message = (envelope.error as Record<string, unknown>).message;
  return typeof message === "string" ? message : "";
}

async function requestBranchModeOrder(method: "GET" | "PATCH", order?: PosSalesMode[]): Promise<BranchSalesModeOrderApiData> {
  const response = await fetch(SALES_MODE_ORDER_API, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: method === "PATCH" ? { "content-type": "application/json" } : undefined,
    body: method === "PATCH" ? JSON.stringify({ order: normalizePosSalesModeOrder(order) }) : undefined
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(parseApiError(payload) || `Sales mode preference request failed (${response.status}).`);
  }
  const data = parseApiData(payload);
  if (!data) throw new Error("Sales mode preference response is invalid.");
  return data;
}

function createTextButton(className: string, label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function createOrderButton(lang: Lang) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pos-mode-order-button";
  button.hidden = true;
  button.setAttribute("aria-label", lang === "th" ? "เธเธฑเธ”เน€เธฃเธตเธขเธเนเธซเธกเธ”เธเธฒเธฃเธเธฒเธขเธเธญเธเธชเธฒเธเธฒ" : "Arrange branch sales modes");
  button.title = lang === "th" ? "เธเธฑเธ”เน€เธฃเธตเธขเธเธฅเธณเธ”เธฑเธเนเธซเธกเธ”เธเธญเธเธชเธฒเธเธฒเธเธตเน" : "Arrange the sales mode order for this branch";

  const icon = document.createElement("span");
  icon.className = "pos-mode-order-button__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "โ•";

  const label = document.createElement("span");
  label.className = "pos-mode-order-button__label";
  label.textContent = lang === "th" ? "เธเธฑเธ”เน€เธฃเธตเธขเธเนเธซเธกเธ”" : "Arrange modes";

  button.append(icon, label);
  return button;
}

function createNotice(lang: Lang) {
  const notice = document.createElement("div");
  notice.className = "pos-mode-order-notice";
  notice.hidden = true;

  const title = document.createElement("strong");
  title.textContent = lang === "th" ? "เธเธ”เธเนเธฒเธเนเธฅเนเธงเธฅเธฒเธเธเธฒเธฃเนเธ”เน€เธเธทเนเธญเธชเธฅเธฑเธเธ•เธณเนเธซเธเนเธ" : "Press and drag a card to swap its position";

  const hint = document.createElement("small");
  hint.textContent =
    lang === "th"
      ? "เธเธฑเธเธ—เธถเธเธเธฃเธฑเนเธเน€เธ”เธตเธขเธง เธ—เธธเธเน€เธเธฃเธทเนเธญเธ POS เนเธเธชเธฒเธเธฒเธเธตเนเธเธฐเนเธเนเธฅเธณเธ”เธฑเธเน€เธ”เธตเธขเธงเธเธฑเธ"
      : "Save once and every POS in this branch will use the same order.";

  const status = document.createElement("small");
  status.className = "pos-mode-order-notice__status";
  status.hidden = true;

  notice.append(title, hint, status);
  return { notice, status };
}

function createFooter(lang: Lang) {
  const footer = document.createElement("div");
  footer.className = "pos-mode-order-footer";
  footer.hidden = true;

  const cancelButton = createTextButton("pos-mode-order-footer__button", lang === "th" ? "เธขเธเน€เธฅเธดเธ" : "Cancel");
  cancelButton.dataset.action = "cancel";

  const saveButton = createTextButton(
    "pos-mode-order-footer__button pos-mode-order-footer__button--primary",
    lang === "th" ? "เธเธฑเธเธ—เธถเธเธ—เธฑเนเธเธชเธฒเธเธฒ" : "Save for branch"
  );
  saveButton.dataset.action = "save";

  footer.append(cancelButton, saveButton);
  return { footer, cancelButton, saveButton };
}

function enhanceModeSelector(selector: HTMLElement, lang: Lang): (() => void) | null {
  if (selector.getAttribute(ENHANCED_ATTRIBUTE) === "1") return null;

  const grid = selector.querySelector<HTMLElement>(GRID_QUERY);
  const header = selector.querySelector<HTMLElement>(HEADER_QUERY);
  const closeButton = selector.querySelector<HTMLElement>(CLOSE_QUERY);
  if (!grid || !header || !closeButton) return null;

  const modeGrid = grid;
  const initialChildren = Array.from(modeGrid.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  if (initialChildren.length < DEFAULT_POS_SALES_MODE_ORDER.length) return null;

  const modeElements = new Map<PosSalesMode, HTMLElement>();
  DEFAULT_POS_SALES_MODE_ORDER.forEach((mode, index) => {
    const element = initialChildren[index];
    if (!element) return;
    element.setAttribute(MODE_ATTRIBUTE, mode);
    modeElements.set(mode, element);
  });
  if (modeElements.size !== DEFAULT_POS_SALES_MODE_ORDER.length) return null;

  selector.setAttribute(ENHANCED_ATTRIBUTE, "1");

  const orderButton = createOrderButton(lang);
  const { notice, status } = createNotice(lang);
  const { footer, cancelButton, saveButton } = createFooter(lang);
  header.insertBefore(orderButton, closeButton);
  selector.insertBefore(notice, modeGrid);
  modeGrid.insertAdjacentElement("afterend", footer);

  let scope: PosScopeIdentity | null = null;
  let scopeKey = "";
  let appliedOrder = [...DEFAULT_POS_SALES_MODE_ORDER];
  let draftOrder = [...DEFAULT_POS_SALES_MODE_ORDER];
  let canManageBranchOrder = false;
  let productProfile: ProductProfileCode | null = null;
  let arranging = false;
  let saving = false;
  let draggingMode: PosSalesMode | null = null;
  let draggingPointerId: number | null = null;
  let savedLabelTimer: number | null = null;
  let syncSequence = 0;
  let destroyed = false;

  function getModeElementFromTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const card = target.closest<HTMLElement>(`[${MODE_ATTRIBUTE}]`);
    return card && modeGrid.contains(card) ? card : null;
  }

  function applyOrder(order: PosSalesMode[]) {
    const normalized = normalizePosSalesModeOrder(order);
    normalized.forEach((mode, index) => {
      const element = modeElements.get(mode);
      if (element) element.style.order = String(index);
    });
  }

  function setStatus(message = "", tone: StatusTone = "info") {
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = !message;
  }

  function setSaving(next: boolean) {
    saving = next;
    saveButton.disabled = next;
    cancelButton.disabled = next;
    saveButton.textContent = next
      ? lang === "th"
        ? "เธเธณเธฅเธฑเธเธเธฑเธเธ—เธถเธ..."
        : "Saving..."
      : lang === "th"
        ? "เธเธฑเธเธ—เธถเธเธ—เธฑเนเธเธชเธฒเธเธฒ"
        : "Save for branch";
  }

  function clearDragState() {
    for (const element of modeElements.values()) {
      element.classList.remove("is-pos-mode-dragging");
    }
    draggingMode = null;
    draggingPointerId = null;
  }

  function updateArrangementDecorations() {
    const hiddenModes = new Set(getHiddenPosSalesModes(scope?.tenantId, productProfile));
    const visibleOrder = normalizePosSalesModeOrder(draftOrder).filter((mode) => !hiddenModes.has(mode));

    for (const [mode, element] of modeElements) {
      const visibleIndex = visibleOrder.indexOf(mode);
      if (!arranging || visibleIndex < 0) {
        element.removeAttribute(RANK_ATTRIBUTE);
        element.removeAttribute("aria-grabbed");
        continue;
      }

      element.setAttribute(RANK_ATTRIBUTE, String(visibleIndex + 1));
      element.setAttribute("aria-grabbed", draggingMode === mode ? "true" : "false");
    }
  }

  function applyVisibilityPolicy() {
    const hiddenModes = new Set(getHiddenPosSalesModes(scope?.tenantId, productProfile));
    for (const [mode, element] of modeElements) {
      if (hiddenModes.has(mode)) {
        element.setAttribute(HIDDEN_ATTRIBUTE, "true");
        element.setAttribute("aria-hidden", "true");
      } else {
        element.removeAttribute(HIDDEN_ATTRIBUTE);
        element.removeAttribute("aria-hidden");
      }
    }
  }

  function finishArrange(nextOrder?: PosSalesMode[]) {
    if (nextOrder) {
      appliedOrder = normalizePosSalesModeOrder(nextOrder);
    }
    draftOrder = [...appliedOrder];
    applyOrder(appliedOrder);
    arranging = false;
    selector.removeAttribute("data-pos-mode-arranging");
    notice.hidden = true;
    footer.hidden = true;
    orderButton.hidden = !canManageBranchOrder;
    setStatus();
    clearDragState();
    updateArrangementDecorations();
  }

  function showSavedLabel() {
    const label = orderButton.querySelector<HTMLElement>(".pos-mode-order-button__label");
    if (!label) return;
    label.textContent = lang === "th" ? "เธเธฑเธเธ—เธถเธเธ—เธฑเนเธเธชเธฒเธเธฒเนเธฅเนเธง" : "Saved for branch";
    if (savedLabelTimer !== null) window.clearTimeout(savedLabelTimer);
    savedLabelTimer = window.setTimeout(() => {
      label.textContent = lang === "th" ? "เธเธฑเธ”เน€เธฃเธตเธขเธเนเธซเธกเธ”" : "Arrange modes";
      savedLabelTimer = null;
    }, 1600);
  }

  async function syncFromBranch(targetScope: PosScopeIdentity, targetScopeKey: string) {
    const requestId = ++syncSequence;
    try {
      const data = await requestBranchModeOrder("GET");
      if (destroyed || requestId !== syncSequence || targetScopeKey !== scopeKey || arranging) return;

      appliedOrder = normalizePosSalesModeOrder(data.order);
      draftOrder = [...appliedOrder];
      canManageBranchOrder = data.can_manage;
      applyOrder(appliedOrder);
      writeStoredModeOrder(targetScope, appliedOrder);
      selector.setAttribute(SOURCE_ATTRIBUTE, "branch");
      orderButton.hidden = !canManageBranchOrder;
      orderButton.title = canManageBranchOrder
        ? lang === "th"
          ? "เธเธฑเธ”เน€เธฃเธตเธขเธเธฅเธณเธ”เธฑเธเนเธซเธกเธ”เธเธญเธเธชเธฒเธเธฒเธเธตเน"
          : "Arrange the sales mode order for this branch"
        : lang === "th"
          ? "Owner เธซเธฃเธทเธญ Manager เน€เธ—เนเธฒเธเธฑเนเธเธ—เธตเนเธเธฑเธ”เน€เธฃเธตเธขเธเธฃเธฐเธ”เธฑเธเธชเธฒเธเธฒเนเธ”เน"
          : "Only an owner or manager can change branch ordering";
      updateArrangementDecorations();
    } catch {
      if (destroyed || requestId !== syncSequence || targetScopeKey !== scopeKey) return;
      // Keep the cached order already applied. Branch save remains unavailable until auth/API recovers.
      selector.setAttribute(SOURCE_ATTRIBUTE, "cache");
    }
  }

  function applyScopePolicy() {
    const nextScope = readCurrentScope();
    const nextScopeKey = nextScope ? `${nextScope.tenantId}:${nextScope.branchId}` : "";
    if (nextScopeKey === scopeKey) return;

    scope = nextScope;
    scopeKey = nextScopeKey;
    syncSequence += 1;
    productProfile = readCachedProductProfile(scope?.tenantId);
    if (scope?.tenantId) {
      const requestedScopeKey = scopeKey;
      void fetchCurrentProductProfile(scope.tenantId).then((profile) => {
        if (destroyed || requestedScopeKey !== scopeKey || !profile) return;
        productProfile = profile;
        applyVisibilityPolicy();
        updateArrangementDecorations();
      });
    }
    canManageBranchOrder = false;
    orderButton.hidden = true;
    applyVisibilityPolicy();

    if (!arranging) {
      appliedOrder = scope ? readStoredModeOrder(scope) : [...DEFAULT_POS_SALES_MODE_ORDER];
      draftOrder = [...appliedOrder];
      applyOrder(appliedOrder);
      selector.setAttribute(SOURCE_ATTRIBUTE, scope ? "cache" : "default");
    }
    updateArrangementDecorations();

    if (scope) void syncFromBranch(scope, scopeKey);
  }

  function startArrange() {
    applyScopePolicy();
    if (!scope || !canManageBranchOrder || saving) return;

    draftOrder = [...appliedOrder];
    arranging = true;
    selector.setAttribute("data-pos-mode-arranging", "true");
    notice.hidden = false;
    footer.hidden = false;
    orderButton.hidden = true;
    setStatus();
    clearDragState();
    updateArrangementDecorations();
  }

  function onPointerDown(event: PointerEvent) {
    if (!arranging || saving || (event.pointerType === "mouse" && event.button !== 0)) return;
    const card = getModeElementFromTarget(event.target);
    const mode = card?.getAttribute(MODE_ATTRIBUTE);
    if (!card || !isPosSalesMode(mode) || card.getAttribute(HIDDEN_ATTRIBUTE) === "true") return;

    event.preventDefault();
    draggingMode = mode;
    draggingPointerId = event.pointerId;
    card.classList.add("is-pos-mode-dragging");
    card.setAttribute("aria-grabbed", "true");
    try {
      card.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional; drag still works while the pointer remains over the grid.
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!arranging || saving || !draggingMode || draggingPointerId !== event.pointerId) return;
    event.preventDefault();

    const pointed = document.elementFromPoint(event.clientX, event.clientY);
    const targetCard = pointed?.closest<HTMLElement>(`[${MODE_ATTRIBUTE}]`) ?? null;
    const targetMode = targetCard?.getAttribute(MODE_ATTRIBUTE);
    if (!targetCard || !modeGrid.contains(targetCard) || !isPosSalesMode(targetMode)) return;
    if (targetCard.getAttribute(HIDDEN_ATTRIBUTE) === "true" || targetMode === draggingMode) return;

    draftOrder = swapPosSalesModes(draftOrder, draggingMode, targetMode);
    applyOrder(draftOrder);
    updateArrangementDecorations();
  }

  function onPointerEnd(event: PointerEvent) {
    if (draggingPointerId !== null && event.pointerId !== draggingPointerId) return;
    clearDragState();
    updateArrangementDecorations();
  }

  function blockModeActivationWhileArranging(event: Event) {
    if (!arranging) return;
    const card = getModeElementFromTarget(event.target);
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  async function onSave() {
    if (saving || !arranging || !scope || !canManageBranchOrder) return;
    const savingScope = scope;
    const savingScopeKey = scopeKey;
    const nextOrder = normalizePosSalesModeOrder(draftOrder);
    setSaving(true);
    setStatus(lang === "th" ? "เธเธณเธฅเธฑเธเธเธฑเธเธ—เธถเธเธฅเธณเธ”เธฑเธเนเธซเนเธ—เธธเธเน€เธเธฃเธทเนเธญเธเนเธเธชเธฒเธเธฒ..." : "Saving this order for every POS in the branch...");

    try {
      const data = await requestBranchModeOrder("PATCH", nextOrder);
      if (destroyed || savingScopeKey !== scopeKey) return;

      canManageBranchOrder = data.can_manage;
      writeStoredModeOrder(savingScope, data.order);
      selector.setAttribute(SOURCE_ATTRIBUTE, "branch");
      finishArrange(data.order);
      showSavedLabel();
    } catch (error) {
      if (destroyed || savingScopeKey !== scopeKey) return;
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(
        lang === "th"
          ? `เธเธฑเธเธ—เธถเธเธฃเธฐเธ”เธฑเธเธชเธฒเธเธฒเนเธกเนเธชเธณเน€เธฃเนเธ โ€” เธขเธฑเธเนเธกเนเธกเธตเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเน€เธเธฃเธทเนเธญเธเธญเธทเนเธ (${message})`
          : `Branch save failed; other POS devices were not changed (${message})`,
        "error"
      );
    } finally {
      if (!destroyed && savingScopeKey === scopeKey) setSaving(false);
    }
  }

  function onCancel() {
    if (saving) return;
    finishArrange();
  }

  function onWindowFocus() {
    if (!selector.isConnected || arranging || !scope) return;
    void syncFromBranch(scope, scopeKey);
  }

  orderButton.addEventListener("click", startArrange);
  cancelButton.addEventListener("click", onCancel);
  saveButton.addEventListener("click", onSave);
  modeGrid.addEventListener("pointerdown", onPointerDown);
  modeGrid.addEventListener("pointermove", onPointerMove);
  modeGrid.addEventListener("pointerup", onPointerEnd);
  modeGrid.addEventListener("pointercancel", onPointerEnd);
  modeGrid.addEventListener("click", blockModeActivationWhileArranging, true);
  modeGrid.addEventListener("keydown", blockModeActivationWhileArranging, true);
  window.addEventListener("focus", onWindowFocus);

  applyScopePolicy();
  const scopeTimer = window.setInterval(() => {
    if (!selector.isConnected) {
      window.clearInterval(scopeTimer);
      return;
    }
    applyScopePolicy();
  }, 400);

  return () => {
    destroyed = true;
    syncSequence += 1;
    window.clearInterval(scopeTimer);
    if (savedLabelTimer !== null) window.clearTimeout(savedLabelTimer);
    orderButton.removeEventListener("click", startArrange);
    cancelButton.removeEventListener("click", onCancel);
    saveButton.removeEventListener("click", onSave);
    modeGrid.removeEventListener("pointerdown", onPointerDown);
    modeGrid.removeEventListener("pointermove", onPointerMove);
    modeGrid.removeEventListener("pointerup", onPointerEnd);
    modeGrid.removeEventListener("pointercancel", onPointerEnd);
    modeGrid.removeEventListener("click", blockModeActivationWhileArranging, true);
    modeGrid.removeEventListener("keydown", blockModeActivationWhileArranging, true);
    window.removeEventListener("focus", onWindowFocus);
    selector.removeAttribute(ENHANCED_ATTRIBUTE);
    selector.removeAttribute("data-pos-mode-arranging");
    selector.removeAttribute(SOURCE_ATTRIBUTE);
    for (const element of modeElements.values()) {
      element.style.removeProperty("order");
      element.removeAttribute(MODE_ATTRIBUTE);
      element.removeAttribute(HIDDEN_ATTRIBUTE);
      element.removeAttribute(RANK_ATTRIBUTE);
      element.removeAttribute("aria-hidden");
      element.removeAttribute("aria-grabbed");
      element.classList.remove("is-pos-mode-dragging");
    }
    orderButton.remove();
    notice.remove();
    footer.remove();
  };
}

export function PosSalesModePreferenceEnhancer({ lang }: { lang: Lang }) {
  useEffect(() => {
    const activeSelectors = new Map<HTMLElement, () => void>();

    const scan = () => {
      for (const [selector, cleanup] of activeSelectors) {
        if (selector.isConnected) continue;
        cleanup();
        activeSelectors.delete(selector);
      }

      for (const node of document.querySelectorAll<HTMLElement>(SELECTOR_QUERY)) {
        if (activeSelectors.has(node)) continue;
        const cleanup = enhanceModeSelector(node, lang);
        if (cleanup) activeSelectors.set(node, cleanup);
      }
    };

    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();

    return () => {
      observer.disconnect();
      for (const cleanup of activeSelectors.values()) cleanup();
      activeSelectors.clear();
    };
  }, [lang]);

  return (
    <style>{`
      .pos-mode-order-button {
        margin-left: auto;
        min-height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 10px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #ffffff;
        color: #334155;
        font: inherit;
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
        cursor: pointer;
      }
      .pos-mode-order-button:hover {
        border-color: #93c5fd;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .pos-mode-order-button__icon {
        display: inline-grid !important;
        place-items: center;
        margin: 0 !important;
        color: currentColor !important;
        font-size: 16px !important;
        line-height: 1 !important;
      }
      .pos-mode-order-button__label {
        display: inline !important;
        margin: 0 !important;
        color: currentColor !important;
        font-size: inherit !important;
      }
      [${HIDDEN_ATTRIBUTE}="true"] {
        display: none !important;
      }
      .pos-mode-order-notice {
        margin-top: 14px;
        padding: 10px 12px;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        background: #eff6ff;
        color: #1e3a8a;
      }
      .pos-mode-order-notice strong,
      .pos-mode-order-notice small {
        display: block;
      }
      .pos-mode-order-notice strong {
        font-size: 13px;
        font-weight: 900;
      }
      .pos-mode-order-notice small {
        margin-top: 3px;
        color: #475569;
        font-size: 11px;
        font-weight: 650;
      }
      .pos-mode-order-notice__status[data-tone="error"] {
        color: #b91c1c;
        font-weight: 800;
      }
      .pos-mode-order-footer {
        justify-content: flex-end;
        gap: 8px;
        padding-top: 14px;
        border-top: 1px solid #e2e8f0;
        margin-top: 14px;
      }
      .pos-mode-order-footer:not([hidden]) {
        display: flex;
      }
      .pos-mode-order-footer__button {
        min-height: 38px;
        padding: 0 14px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #ffffff;
        color: #334155;
        font: inherit;
        font-size: 13px;
        font-weight: 850;
        cursor: pointer;
      }
      .pos-mode-order-footer__button:disabled {
        cursor: wait;
        opacity: 0.65;
      }
      .pos-mode-order-footer__button--primary {
        border-color: #2563eb;
        background: #2563eb;
        color: #ffffff;
      }
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-selector__grid {
        touch-action: none;
      }
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-option {
        position: relative;
        cursor: grab;
        user-select: none;
        touch-action: none;
        border-style: dashed;
      }
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-option:hover {
        transform: none;
      }
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-option__check {
        display: none !important;
      }
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-option.is-pos-mode-dragging {
        cursor: grabbing;
        opacity: 0.72;
        transform: scale(0.985);
        border-color: #2563eb;
        box-shadow: 0 14px 30px rgba(37, 99, 235, 0.18);
      }
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-option[${RANK_ATTRIBUTE}]::before,
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-option[${RANK_ATTRIBUTE}]::after {
        position: absolute;
        top: 10px;
        z-index: 2;
        display: grid;
        place-items: center;
        border-radius: 999px;
        pointer-events: none;
      }
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-option[${RANK_ATTRIBUTE}]::before {
        content: attr(${RANK_ATTRIBUTE});
        right: 42px;
        width: 24px;
        height: 24px;
        background: #dbeafe;
        color: #1d4ed8;
        font-size: 11px;
        font-weight: 950;
      }
      .posui-mode-selector[data-pos-mode-arranging="true"] .posui-mode-option[${RANK_ATTRIBUTE}]::after {
        content: "โฎโฎ";
        right: 10px;
        width: 26px;
        height: 24px;
        color: #64748b;
        font-size: 14px;
        font-weight: 900;
        letter-spacing: -4px;
      }
      @media (max-width: 640px) {
        .pos-mode-order-button {
          padding: 0 8px;
        }
        .pos-mode-order-button__label {
          display: none !important;
        }
      }
    `}</style>
  );
}

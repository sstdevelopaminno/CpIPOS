import { GENERAL_SALE_ROOT_ATTRIBUTE, GENERAL_SALE_MODE_ID, OPTICAL_ACTIVE_ROOT_ATTRIBUTE } from "../pos-general-sale-mode";
export function canRestoreRetailScannerFocus(input: {
  mode: string | null; optical: boolean; visible: boolean; modalOpen: boolean;
  fieldReady: boolean; focus: "field" | "idle" | "trigger" | "other";
}): boolean {
  return input.mode === GENERAL_SALE_MODE_ID && !input.optical && input.visible &&
    !input.modalOpen && input.fieldReady && input.focus !== "other";
}
/** SD/RW only; no global scanner interception or focus theft. */
export function focusRetailScanner(doc: Document, field?: HTMLInputElement | null, trigger?: Element): boolean {
  const input = field === undefined ? doc.querySelector<HTMLInputElement>('input[data-pos-general-sale-sku="1"]') : field;
  if (!input) return false;
  const active = doc.activeElement;
  const focus = active === input ? "field" : !active || active === doc.body || active === doc.documentElement
    ? "idle" : active === trigger ? "trigger" : "other";
  const modalOpen = Array.from(doc.querySelectorAll<HTMLElement>('[aria-modal="true"], .posui-mode-selector-backdrop, [data-testid="pos-startup-mode-gate"]'))
    .some(node => node.getClientRects().length > 0);
  if (!canRestoreRetailScannerFocus({
    mode: doc.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE),
    optical: doc.documentElement.getAttribute(OPTICAL_ACTIVE_ROOT_ATTRIBUTE) === "1",
    visible: doc.visibilityState === "visible",
    modalOpen, fieldReady: input.isConnected && !input.disabled && !input.readOnly && input.getClientRects().length > 0, focus
  })) return false;
  if (active !== input) input.focus({ preventScroll: true });
  return doc.activeElement === input;
}

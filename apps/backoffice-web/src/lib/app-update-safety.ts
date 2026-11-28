import { getOfflineSaleSummary } from "@/lib/pos-offline-sale-store";

// All known persisted sale/hold state, including the standalone offline shell.
const ACTIVE_POS_STORAGE_KEYS = [
  "pos_sales_cart_v012",
  "pos_pending_submit_v012",
  "pos_pending_submit_queue_v001",
  "pos_pending_payment_queue_v001",
  "pos_active_order_v001",
  "pos_dine_in_selected_table_v001",
  "cpipos_offline_holds_v3"
] as const;

export function hasStoredWork(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value.length > 0;
    if (value === null) return false;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return Boolean(value);
  } catch {
    return true;
  }
}

export function hasLegacyUnsyncedSales(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const sales: unknown = JSON.parse(raw);
    if (!Array.isArray(sales)) return true;
    return sales.some((sale) => !sale || typeof sale !== "object" ||
      !["synced", "voided"].includes(sale.status));
  } catch {
    return true;
  }
}

export function isUpdateSafeRoute(pathname: string): boolean {
  // Do not infer that an in-memory checkout is idle merely from localStorage.
  return pathname === "/login/store";
}

export function isLocallyIdle(): boolean {
  return navigator.onLine && isUpdateSafeRoute(window.location.pathname) &&
    !ACTIVE_POS_STORAGE_KEYS.some((key) => hasStoredWork(window.localStorage.getItem(key))) &&
    !hasLegacyUnsyncedSales(window.localStorage.getItem("cpipos_offline_sales_v3"));
}

export async function isSafeForAppUpdate(): Promise<boolean> {
  try {
    if (!isLocallyIdle()) return false;
    const summary = await getOfflineSaleSummary({});
    return summary.queued === 0 && summary.syncing === 0 && summary.failed === 0 && isLocallyIdle();
  } catch {
    // Unreadable state is not proof of an idle register.
    return false;
  }
}

export function isTrustedAndroidDownload(value: string, origin: string): boolean {
  try {
    const url = new URL(value, origin);
    return url.protocol === "https:" && url.origin === origin && !url.username && !url.password && !url.search && !url.hash &&
      ["/download/android/latest", "/download/android/modern-latest"].includes(url.pathname);
  } catch {
    return false;
  }
}

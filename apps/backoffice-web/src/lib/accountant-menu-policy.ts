/** Finance-only navigation contract. This is not a grant to POS cashier APIs.
 * Key names intentionally match tenant_pos_menu_policies in CpIPOS and CpIPOS-IT.
 */
export type AccountantNavItem = { key: string; label: string; slug: string; group: "more" | "settings" };
export const ACCOUNTANT_MORE_MENU: readonly AccountantNavItem[] = [
  { key: "more.sales_summary", label: "สรุปยอดขาย", slug: "sales-summary", group: "more" },
  { key: "more.receipts", label: "ใบเสร็จย้อนหลัง", slug: "receipts", group: "more" },
  { key: "more.tax_invoices", label: "ออกใบกำกับภาษี", slug: "tax-invoices", group: "more" },
  { key: "more.product_sales", label: "รายงานรายการขาย", slug: "product-sales", group: "more" }
] as const;
// Product master data and inventory are POS operations, not Accountant Finance routes.
// Product-level completed sales remain accessible only as an accounting report.

// Keep operational POS settings out of the Accountant workspace; removing a key
// also disables direct /finance/settings/[slug] access via accountantMenuItem.
export const ACCOUNTANT_SETTINGS_MENU: readonly AccountantNavItem[] = [
  { key: "settings.branding", label: "ธีมสี / โลโก้ / ชื่อระบบ (CUSTOM)", slug: "branding", group: "settings" },
  { key: "settings.store", label: "ข้อมูลร้านค้า/บริษัท", slug: "store", group: "settings" },
  { key: "settings.printers", label: "ตั้งค่าเครื่องพิมพ์", slug: "printers", group: "settings" },
  { key: "settings.payments", label: "ตั้งค่าชำระเงิน", slug: "payments", group: "settings" },
  { key: "settings.taxes", label: "ตั้งค่าภาษี", slug: "taxes", group: "settings" },
  { key: "settings.support", label: "ศูนย์ช่วยเหลือ", slug: "support", group: "settings" },
  { key: "settings.push_notifications", label: "การแจ้งเตือนอุปกรณ์", slug: "push-notifications", group: "settings" },
  { key: "settings.language", label: "เปลี่ยนภาษา", slug: "language", group: "settings" },
  { key: "settings.currency", label: "ตั้งค่าสกุลเงิน (CUSTOM)", slug: "currency", group: "settings" },
  { key: "settings.placement", label: "สลับแถบเมนูหลัก", slug: "placement", group: "settings" },
] as const;

export const ACCOUNTANT_MAIN_MENU_KEYS = ["main.finance", "main.more", "main.settings", "main.package_payment"] as const;
export const ACCOUNTANT_ALLOWED_MENU_KEYS: readonly string[] = [
  ...ACCOUNTANT_MAIN_MENU_KEYS,
  ...ACCOUNTANT_MORE_MENU.map(item => item.key),
  ...ACCOUNTANT_SETTINGS_MENU.map(item => item.key)
];

export function accountantMenuItem(group: string, slug: string): AccountantNavItem | null {
  if (group !== "more" && group !== "settings") return null;
  return [...ACCOUNTANT_MORE_MENU, ...ACCOUNTANT_SETTINGS_MENU].find(
    item => item.group === group && item.slug === slug
  ) ?? null;
}

/** Enforce IT navigation denials, including a disabled parent.
 * No IT menu switch can expand the role allowlist.
 */
export function isAccountantMenuVisible(menuKey: string, overrides: Record<string, boolean>): boolean {
  if (!ACCOUNTANT_ALLOWED_MENU_KEYS.includes(menuKey)) return false;
  const parent = menuKey.startsWith("more.") ? "main.more" :
    menuKey.startsWith("settings.") ? "main.settings" : null;
  return overrides["main.finance"] !== false &&
    overrides[menuKey] !== false &&
    (!parent || overrides[parent] !== false);
}

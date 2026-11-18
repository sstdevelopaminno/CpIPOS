/** Finance-only navigation contract. This is not a grant to POS cashier APIs.
 * Key names intentionally match tenant_pos_menu_policies in CpIPOS and CpIPOS-IT.
 */
export type AccountantNavItem = { key: string; label: string; slug: string; group: "settings" };
export type AccountantFinanceItem = { key: string; label: string; slug: string };
/** Navigation-only permissions; no automatic right to post journal entries or issue tax documents. */
export const ACCOUNTANT_FINANCE_MENU: readonly AccountantFinanceItem[] = [
  { key: "finance.income", label: "รายรับ", slug: "income" },
  { key: "finance.expenses", label: "รายจ่าย", slug: "expenses" },
  { key: "finance.sales_receivables", label: "งานขายและลูกหนี้", slug: "sales-receivables" },
  { key: "finance.purchases_payables", label: "งานซื้อและเจ้าหนี้", slug: "purchases-payables" },
  { key: "finance.banking", label: "การเงินและธนาคาร", slug: "banking" },
  { key: "finance.ledger", label: "บัญชีแยกประเภท", slug: "ledger" },
  { key: "finance.tax_reports", label: "ภาษีและรายงาน", slug: "tax-reports" }
] as const;

export function accountantFinanceModule(slug: string): AccountantFinanceItem | null {
  return ACCOUNTANT_FINANCE_MENU.find(item => item.slug === slug) ?? null;
}

// Legacy POS More menu is not part of the Accountant permission model.
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

export const ACCOUNTANT_MAIN_MENU_KEYS = ["main.finance", "main.settings", "main.package_payment"] as const;
export const ACCOUNTANT_ALLOWED_MENU_KEYS: readonly string[] = [
  ...ACCOUNTANT_MAIN_MENU_KEYS,
  ...ACCOUNTANT_FINANCE_MENU.map(item => item.key),
  ...ACCOUNTANT_SETTINGS_MENU.map(item => item.key)
];

export function accountantMenuItem(group: string, slug: string): AccountantNavItem | null {
  if (group !== "settings") return null;
  return ACCOUNTANT_SETTINGS_MENU.find(item => item.slug === slug) ?? null;
}

/** Enforce IT navigation denials, including a disabled parent.
 * No IT menu switch can expand the role allowlist.
 */
export function isAccountantMenuVisible(menuKey: string, overrides: Record<string, boolean>): boolean {
  if (!ACCOUNTANT_ALLOWED_MENU_KEYS.includes(menuKey)) return false;
  const parent = menuKey.startsWith("finance.") ? "main.finance" :
    menuKey.startsWith("settings.") ? "main.settings" : null;
  return overrides["main.finance"] !== false &&
    overrides[menuKey] !== false &&
    (!parent || overrides[parent] !== false);
}

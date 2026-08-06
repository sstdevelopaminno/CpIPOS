import { roleCan } from "@/lib/permissions/mobile-features";
import type { BranchRole, MobilePermissionKey, PosFeatureCode } from "@/types/contracts";
import { BadgeDollarSign, ClipboardList, PackageSearch, ReceiptText, Settings, ShoppingCart, type LucideIcon } from "lucide-react";

export type MobileMenuItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: MobilePermissionKey;
  feature: PosFeatureCode;
};

export const mobileMenuItems: MobileMenuItem[] = [
  { href: "/sales", label: "ขาย", icon: ShoppingCart, permission: "sales:view", feature: "core_pos_sales" },
  { href: "/orders", label: "รายการขาย", icon: ReceiptText, permission: "sales:list:view", feature: "advanced_sales_reports" },
  { href: "/stock", label: "สินค้า", icon: PackageSearch, permission: "inventory:view", feature: "stock_management" },
  { href: "/shifts", label: "ปิดยอด", icon: BadgeDollarSign, permission: "shift:close", feature: "attendance_tracking" },
  { href: "/settings", label: "ตั้งค่า", icon: Settings, permission: "settings:view", feature: "core_pos_sales" },
];

export const mobileSecondaryMenuItems: MobileMenuItem[] = [
  { href: "/attendance", label: "เข้างาน", icon: ClipboardList, permission: "attendance:view_self", feature: "attendance_tracking" },
];

export function getMobileMenuItems(role: BranchRole) {
  return mobileMenuItems.filter((item) => roleCan(role, item.permission));
}

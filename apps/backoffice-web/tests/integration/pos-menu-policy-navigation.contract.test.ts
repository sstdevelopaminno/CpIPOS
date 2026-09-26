import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const api = read("../../src/app/api/pos/features/route.ts");
const shell = read("../../src/components/pos-preview/pos-shell-sidebar.tsx");
const staffMenu = read("../../src/components/pos-preview/pos-staff-menu.tsx");
const more = read("../../src/components/pos-preview/pos-more-workspace.tsx");
const settings = read("../../src/components/pos-preview/pos-settings-workspace.tsx");
const server = read("../../src/lib/server/pos-menu-policy-service.ts");
const qrPortal = read("../../src/components/pos-preview/table-qr-settings-menu-portal.tsx");
const settingsPage = read("../../src/app/preview/pos/settings/page.tsx");
const lockDialog = read("../../src/components/pos-preview/it-menu-lock-dialog.tsx");

describe("POS tenant menu toggle regression", () => {
  it("uses one authoritative policy table in the POS feature endpoint", () => {
    expect(api).toContain("getTenantPosMenuOverrides");
    expect(api).toContain("menu_policy:");
    expect(server).toContain('from("tenant_pos_menu_policies")');
    expect(server).not.toContain("notFound()");
    expect(server).toContain("Legacy page call-site kept as a no-op");
  });
  it("retains menus across all POS navigation surfaces without overriding package/role access", () => {
    expect(shell).toContain('isPosMenuEnabled("main.settings", menuPolicy)');
    expect(staffMenu).toContain('isPosMenuEnabled("main.more", menuPolicy)');
    expect(staffMenu).toContain("onLockedMenu(item.label)");
    expect(staffMenu).not.toContain('item.roles.includes(effectiveRole) && isPosMenuEnabled(');
    expect(staffMenu).toContain('!isPosMenuEnabled("main.payments", menuPolicy)');
    expect(staffMenu).toContain('isPosMenuEnabled("main.payments", menuPolicy)');
    expect(more).toContain("isPosMenuEnabled(posMenuKeyForRoute(href)");
    expect(more).toContain("setItLockedMenu(label)");
    expect(settings).toContain("menuVisible(\"settings.");
    expect(settings).toContain("setItLockedMenu");
    expect(settings).not.toContain('menuEnabled={menuVisible("settings.');
    expect(settings).toContain('if (!menuVisible("settings." + viewKey)) {');
  });
  it("retains injected Order Kitchen / Table QR cards and locks them on selection", () => {
    expect(settingsPage).toContain("getTenantPosMenuOverrides(scope.session.tenant_id)");
    expect(settingsPage).toContain("menuPolicy={settingsMenuPolicy}");
    expect(qrPortal).toContain('isPosMenuEnabled("settings.order_kitchen", menuPolicy)');
    expect(qrPortal).toContain('isPosMenuEnabled("settings.table_qr", menuPolicy)');
    expect(qrPortal).toContain("timelineEnabled");
    expect(qrPortal).toContain("ItMenuLockDialog");
  });
  it("keeps the IT lock popup dismissible above the POS shell", () => {
    expect(lockDialog).toContain("createPortal");
    expect(lockDialog).toContain("document.body");
    expect(lockDialog).toContain('event.key !== "Escape"');
    expect(lockDialog).toContain("event.target === event.currentTarget");
    expect(lockDialog).toContain("event.stopPropagation()");
    expect(lockDialog).toContain("รับทราบ");
    expect(lockDialog).toContain("z-[300]");
  });

  it("preserves POS direct URL availability; IT menu locks are UI-only, not 404 gates", () => {
    const pages = [
      "page.tsx", "sales-list/page.tsx", "kitchen/page.tsx", "shift/page.tsx",
      "payments/page.tsx", "more/page.tsx", "sales-summary/page.tsx",
      "receipts/page.tsx", "tables/page.tsx", "members/page.tsx",
      "stock/page.tsx", "stock/media/page.tsx", "kitchen/manage/page.tsx",
      "buffet-pricing/page.tsx", "product-sales/page.tsx",
      "tax-invoices/page.tsx", "settings/page.tsx",
      "settings/order-kitchen/page.tsx", "settings/table-qr/page.tsx",
      "settings/table-qr/timeline/page.tsx", "customer-display/page.tsx",
      "customer-display/v2-preview/page.tsx", "users/page.tsx"
    ];
    for (const page of pages) {
      const source = read("../../src/app/preview/pos/" + page);
      expect(source, page).toContain("assertPosMenuPageAllowed");
    }
    expect(server).toContain("navigation controls");
    expect(shell).toContain("isSettingsPolicyLocked");
    expect(shell).toContain("ItMenuLockDialog");
    for (const component of [shell, more, settings]) {
      expect(component).toContain('window.addEventListener("focus", onFocus)');
      expect(component).toContain('document.addEventListener("visibilitychange", onVisibility)');
      expect(component).toContain('window.removeEventListener("focus", onFocus)');
      expect(component).toContain('document.removeEventListener("visibilitychange", onVisibility)');
      expect(component).toContain("lastRefresh < 5_000");
    }
    // A failed /api/pos/features response must not overwrite the menu policy.
    expect(more).toContain("if (!cancelled && response.ok) {");
  });
});

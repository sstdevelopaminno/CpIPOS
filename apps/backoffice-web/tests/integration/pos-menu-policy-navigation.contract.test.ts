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

describe("POS tenant menu toggle regression", () => {
  it("uses one authoritative policy table in the POS feature endpoint", () => {
    expect(api).toContain("getTenantPosMenuOverrides");
    expect(api).toContain("menu_policy:");
    expect(server).toContain('from("tenant_pos_menu_policies")');
    expect(server).toContain("notFound()");
  });
  it("hides menus across all three POS navigation surfaces without overriding package/role access", () => {
    expect(shell).toContain('isPosMenuEnabled("main.settings", menuPolicy)');
    expect(staffMenu).toContain('isPosMenuEnabled("main.more", menuPolicy)');
    expect(staffMenu).toContain('isPosMenuEnabled("main.payments", menuPolicy)');
    expect(more).toContain("isPosMenuEnabled(posMenuKeyForRoute(item.href)");
    expect(settings).toContain("menuVisible(\"settings.");
    expect(settings).toContain('if (!menuVisible("settings." + viewKey)) return;');
  });
  it("hides injected Order Kitchen / Table QR cards with tenant policy too", () => {
    expect(settingsPage).toContain("getTenantPosMenuOverrides(scope.session.tenant_id)");
    expect(settingsPage).toContain("menuPolicy={settingsMenuPolicy}");
    expect(qrPortal).toContain('isPosMenuEnabled("settings.order_kitchen", menuPolicy)');
    expect(qrPortal).toContain('isPosMenuEnabled("settings.table_qr", menuPolicy)');
    expect(qrPortal).toContain("showTableQr && timelineEnabled");
  });
  it("server-checks direct POS navigation instead of relying on hidden links alone", () => {
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
  });
});

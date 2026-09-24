import { describe, expect, it } from "vitest";
import {
  POS_MENU_CATALOG, isPosMenuEnabled, posMenuKeyForRoute
} from "../../src/lib/pos-menu-policy";

describe("IT-controlled POS tenant menu policy", () => {
  it("keeps all existing pages visible if IT has not configured an override", () => {
    for (const item of POS_MENU_CATALOG) expect(isPosMenuEnabled(item.key, {})).toBe(true);
  });
  it("locks only the exact menu selected by IT; never cascades across main and submenus", () => {
    const overrides = { "main.more": false, "more.receipts": true };
    expect(isPosMenuEnabled("main.more", overrides)).toBe(false);
    expect(isPosMenuEnabled("more.receipts", overrides)).toBe(true);
    expect(isPosMenuEnabled("settings.store", overrides)).toBe(true);
    expect(isPosMenuEnabled("more.receipts", { "main.more": true, "more.receipts": false })).toBe(false);
    expect(isPosMenuEnabled("main.more", { "main.more": true, "more.receipts": false })).toBe(true);
  });
  it("matches the most specific parent/submenu route and never disables unknown paths", () => {
    expect(posMenuKeyForRoute("/preview/pos")).toBe("main.sales");
    expect(posMenuKeyForRoute("/preview/pos/more")).toBe("main.more");
    expect(posMenuKeyForRoute("/preview/pos/stock/media")).toBe("more.stock");
    expect(posMenuKeyForRoute("/preview/pos/kitchen/manage")).toBe("more.kitchen_manage");
    expect(posMenuKeyForRoute("/preview/pos/kitchen")).toBe("main.kitchen");
    expect(posMenuKeyForRoute("/preview/pos/settings/table-qr/timeline")).toBe("settings.table_qr");
    expect(posMenuKeyForRoute("/preview/pos/customer-display/v2-preview")).toBe("settings.display");
    expect(posMenuKeyForRoute("/preview/pos/users")).toBe("settings.users");
    expect(posMenuKeyForRoute("/api/pos/sales-list")).toBeNull();
  });
});

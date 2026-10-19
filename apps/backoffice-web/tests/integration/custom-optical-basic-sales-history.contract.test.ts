import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const load = (p: string) => readFileSync(resolve(process.cwd(), "src", p), "utf8");
const page = load("app/preview/pos/sales-list/page.tsx");
const api = load("app/api/pos/optical/sales-history/route.ts");
const menu = load("components/pos-preview/pos-staff-menu.tsx");
const ui = load("components/pos-preview/pos-optical-basic-sales-history.tsx");

describe("CUSTOM Optical basic sales history security", () => {
  it("keeps IT tenant menu control and authenticated POS sales permissions", () => {
    expect(page).toContain('assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/sales-list")');
    expect(page).toContain('requirePermission(posMenuScope, "sales:list:view")');
    expect(page).toContain("requireOpticalRetailEntitlement");
    expect(api).toContain('requirePermission(scope, "sales:list:view")');
    expect(api).toContain('isCustomPosMenuVisible("main.sales_list", policies, true)');
    expect(api).toContain('Cache-Control", "private, no-store"');
  });
  it("has GET only, never changes sales or stock", () => {
    expect(api).toContain("export async function GET()");
    expect(api).not.toContain("export async function PATCH");
    expect(api).not.toContain("export async function DELETE");
    expect(ui).not.toContain('method: "DELETE"');
    expect(ui).not.toContain('method: "PATCH"');
  });
  it("keeps advanced report entitlements intact for regular tenants", () => {
    expect(page).toContain('requirePosPagePermission("sales:list:view")');
    expect(menu).toContain('item.href === "/preview/pos/sales-list"');
    expect(menu).toContain("const featureLocked = !opticalBasicHistory");
    expect(api).toContain('platformRole: "tenant_user"');
    expect(api).toContain('tenantId: scope.session.tenant_id');
  });
});

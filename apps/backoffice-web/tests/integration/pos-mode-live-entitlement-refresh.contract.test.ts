import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("live POS mode policy refresh across IT and the selector", () => {
  const api = source("src/app/api/pos/features/route.ts");
  const selector = source("src/components/pos/pos-general-sale-table-controller.tsx");
  const policy = source("src/components/pos/pos-sales-mode-policy-controller.tsx");

  it("provides an authenticated uncached feature snapshot on explicit refresh", () => {
    expect(api).toContain("await requirePosSession()");
    expect(api).toContain('searchParams.get("refresh") === "1"');
    expect(api).toContain("forceFresh");
    expect(api).toContain("value: await loader()");
    expect(api).toContain('"private, no-store, max-age=0"');
  });

  it("rechecks the IT flags whenever a mode dialog opens, without reloading POS", () => {
    expect(selector).toContain("selector !== latestSelector");
    expect(selector).toContain("if (selector) void loadAccess()");
    expect(selector).toContain('fetch("/api/pos/features?refresh=1"');
    expect(selector).toContain("isAuthorizedOpticalRetailMode(body.data)");
    expect(selector).not.toContain("body?.data?.features?.core_pos_sales === true");
    expect(selector).toContain("sales_modes?.general_sale === true");
    expect(selector).toContain("if (generalSaleActive && (opticalActive ? !opticalAllowed : !generalSaleAllowed))");
    expect(selector).toContain('window.addEventListener("focus", onFocus)');
    expect(selector).not.toContain('window.setInterval(() => {');
    expect(selector).toContain('window.addEventListener("focus", onFocus)');
  });

  it("updates all ordinary mode cards from the same fresh IT entitlement", () => {
    expect(selector).toContain('"cpipos:pos-feature-policy-updated"');
    expect(policy).toContain('window.addEventListener("cpipos:pos-feature-policy-updated"');
    expect(policy).toContain("modes = normalizePosSalesModes(data.sales_modes)");
    expect(policy).toContain("isCustom = data.is_custom === true || data.is_internal_test_full === true");
    expect(policy).toContain('key === "optical_retail" && !isCustom');
  });

  it("resolves initial React mode from a fresh authenticated CUSTOM snapshot", () => {
    const startup=source("src/components/pos/pos-initial-sales-mode-controller.tsx");
    const entry=source("src/components/pos/pos-entry-gate.tsx");
    const sales=source("src/components/pos/pos-sales-module.tsx");
    expect(startup).toContain('const FEATURES_API = "/api/pos/features?refresh=1"');
    expect(startup).toContain("getAuthorizedCustomPosStartupMode(order ?? [], productProfile, customModeGrants)");
    expect(startup).toContain('if (customPolicy && !authorizedCustomMode) return fail("POS-START-GRANTS")');
    expect(startup).toContain("activeModeRef.current = mode;");
    expect(startup).toContain("<SalesComponent lang={lang} startupMode={authorizedMode} onStartupModeReady={onReady} onStartupModeBlocked={onBlocked} />");
    expect(entry).toContain("SalesComponent={PosSalesModule}");
    expect(sales).toContain("lastAppliedStartupModeRef.current === startupMode");
    expect(sales).toContain("onStartupModeReady?.(startupMode)");
    expect(sales).not.toContain("window.addEventListener(POS_STARTUP_MODE_REQUEST_EVENT");
  });

  it("does not treat a server grant as a rendered checkout, and revokes disabled modes", () => {
    const startup=source("src/components/pos/pos-initial-sales-mode-controller.tsx");
    const sales=source("src/components/pos/pos-sales-module.tsx");
    expect(startup).toContain('"POS-START-REACT"');
    expect(startup).toContain('window.addEventListener("cpipos:pos-feature-policy-updated", onPolicyUpdated)');
    expect(startup).toContain("if (allowed) return");
    expect(startup).toContain("launchedWithCustomPolicyRef.current");
    expect(startup).toContain('isAuthorizedOpticalRetailMode(data)');
    expect(startup).not.toContain("activateModeWithoutDialog(");
    expect(startup).not.toContain("POS_STARTUP_MODE_REQUEST_EVENT");
    expect(sales).toContain('opticalRetailActive && quickMode === "home" && startupRetailKind === "optical_retail"');
    expect(sales).toContain('data-pos-react-sales-mode=');
    expect(sales).toContain('tableBrowserOpen || Boolean(selectedTable?.id)');
    expect(sales).toContain('orderType === "takeaway" && !selectedTable?.id');
    expect(selector).toContain('reactMode === OPTICAL_MODE_ID && opticalAllowed');
    expect(selector).toContain('reactMode === GENERAL_SALE_MODE_ID && generalSaleAllowed');
  });

  it("keeps legacy background cache for normal polling, but forces fresh on dialog opening", () => {
    expect(api).toContain("ttlMs: 60_000");
    expect(policy).toContain("if (selector) void requestPolicy(true)");
  });
});

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
    expect(selector).toContain("sales_modes?.optical_retail === true");
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

  it("keeps legacy background cache for normal polling, but forces fresh on dialog opening", () => {
    expect(api).toContain("ttlMs: 60_000");
    expect(policy).toContain("if (selector) void requestPolicy(true)");
  });
});

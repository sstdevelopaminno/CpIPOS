import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeGeneralSaleScanCode } from "../../src/lib/pos-general-sale-mode";
import { isAuthorizedOpticalRetailMode } from "../../src/lib/pos-sales-modes";

const source = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");

describe("CUSTOM Optical scanner and single-unit stock path", () => {
  const controller = source("components/pos/pos-general-sale-table-controller.tsx");
  const sales = source("components/pos/pos-sales-module.tsx");
  const catalog = source("components/pos/pos-product-catalog.tsx");
  const lookup = source("app/api/pos/products/lookup/route.ts");
  const tableModel = source("lib/pos-general-sale-cart-table.ts");

  it("never grants Optical to a normal plan without CUSTOM authorization", () => {
    expect(isAuthorizedOpticalRetailMode({ is_custom: false, sales_modes: { optical_retail: true } })).toBe(false);
    expect(isAuthorizedOpticalRetailMode({ is_custom: true, sales_modes: { optical_retail: false } })).toBe(false);
    expect(isAuthorizedOpticalRetailMode({ is_custom: true, sales_modes: { optical_retail: true } })).toBe(true);
    expect(controller).toContain("opticalAllowed = isAuthorizedOpticalRetailMode(body.data)");
  });

  it("adds each Optical SKU to React cart directly without the restaurant ingredient modal", () => {
    expect(sales).toContain("if (opticalRetailActive) return addCartLine(product)");
    expect(sales).toContain("if (product.has_recipe_deduction) {");
    expect(sales).toContain("setModifierDraft({ product, quantity: 1");
    expect(sales).toContain("return addCartLine(product)");
    expect(sales).toContain("stockUnits");
    expect(sales).toContain("cartQty + quantity > Number(stockUnits)");
    expect(sales).toContain("return false");
    expect(catalog).toContain('accepted === false ? "unavailable" : "added"');
  });

  it("supports no-Enter scanners, slow HID streams, paste and full alphanumeric SKUs", () => {
    expect(controller).toContain("OPTICAL_SCAN_IDLE_MS = 140");
    expect(controller).toContain("OPTICAL_MANUAL_IDLE_MS = 480");
    expect(controller).toContain("input.value.trim() !== raw");
    expect(controller).toContain("void submitScan(raw, status, input, submit)");
    expect(controller).toContain("opticalActive ? originalSku : scanCode");
    expect(controller).toContain("scanQueue.push(opticalActive ? originalSku : scanCode)");
    // The legacy decoder retains digit-only canonicalization for old barcodes,
    // but the endpoint must try the original alphanumeric SKU first.
    expect(normalizeGeneralSaleScanCode("QA-LAK-FRAME-001")).toBe("001");
    expect(lookup).toContain("canonicalSku !== scanCode ? canonicalSku : scanCode");
    expect(lookup).toContain('.eq("sku", exactCode)');
    expect(lookup).toContain('.eq("tenant_id", input.tenantId)');
    expect(lookup).toContain('.eq("branch_id", input.branchId)');
  });

  it("uses authorized LAK label in the actual mounted scanner/table controller", () => {
    expect(controller).toContain("formatSalesMoney(value, normalizeSalesCurrency(");
    expect(controller).toContain('attributeFilter: ["data-pos-store-currency"]');
    expect(controller).toContain("buildGeneralSaleCartTableSignature(rows)");
    expect(tableModel).toContain("lineTotal");
    expect(controller).not.toContain('currency: "THB"');
  });

  it("does not issue another checkout, stock write, deposit or payment call from the scanner", () => {
    expect(controller).toContain("GENERAL_SALE_ADD_PRODUCT_EVENT");
    expect(controller).not.toContain('fetch("/api/pos/sales"');
    expect(controller).not.toContain('fetch("/api/pos/payments"');
    expect(controller).not.toContain("update public.ingredients");
    expect(controller).not.toContain("/api/pos/optical/deposit");
  });
});

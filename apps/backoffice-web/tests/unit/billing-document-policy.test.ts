import { describe, expect, it } from "vitest";
import { filterBillingDocumentItems, shouldSuppressZeroPriceBillingLines } from "../../src/lib/billing-document-policy";

type Item = { name: string; unit_price: unknown };

const items: Item[] = [
  { name: "QR included food", unit_price: 0 },
  { name: "Buffet per person", unit_price: 399 },
  { name: "Paid add-on", unit_price: 49 },
  { name: "Negative adjustment", unit_price: -20 }
];

describe("billing document policy", () => {
  it("resolves zero-price suppression from the BUFFET product profile", () => {
    expect(shouldSuppressZeroPriceBillingLines({ productProfile: "BUFFET" })).toBe(true);
    expect(shouldSuppressZeroPriceBillingLines({ tenantCode: "FF0001" })).toBe(true);
    expect(shouldSuppressZeroPriceBillingLines({ tenantCode: "FG0004" })).toBe(false);
    expect(shouldSuppressZeroPriceBillingLines({ tenantMetadata: { product_profile: "BUFFET" } })).toBe(true);
  });

  it("removes only zero-priced document lines for buffet billing scopes", () => {
    const result = filterBillingDocumentItems(items, { productProfile: "BUFFET" }, (item) => item.unit_price);
    expect(result.map((item) => item.name)).toEqual([
      "Buffet per person",
      "Paid add-on",
      "Negative adjustment"
    ]);
  });

  it("does not change Restaurant QR or Standard document lines", () => {
    expect(filterBillingDocumentItems(items, { productProfile: "RESTAURANT_QR" }, (item) => item.unit_price)).toEqual(items);
    expect(filterBillingDocumentItems(items, { tenantCode: "FG0004" }, (item) => item.unit_price)).toEqual(items);
    expect(filterBillingDocumentItems(items, { productProfile: "STANDARD" }, (item) => item.unit_price)).toEqual(items);
  });

  it("does not change missing store scopes", () => {
    expect(filterBillingDocumentItems(items, null, (item) => item.unit_price)).toEqual(items);
  });

  it("keeps malformed or missing prices fail-safe instead of hiding them", () => {
    const uncertain: Item[] = [
      { name: "missing", unit_price: null },
      { name: "blank", unit_price: "" },
      { name: "malformed", unit_price: "not-a-number" },
      { name: "zero", unit_price: "0" }
    ];
    expect(filterBillingDocumentItems(uncertain, { productProfile: "BUFFET" }, (item) => item.unit_price).map((item) => item.name)).toEqual([
      "missing",
      "blank",
      "malformed"
    ]);
  });
});
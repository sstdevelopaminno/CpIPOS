import { describe, expect, it } from "vitest";
import { filterBillingDocumentItems, isFfStoreCode } from "../../src/lib/billing-document-policy";

type Item = { name: string; unit_price: unknown };

const items: Item[] = [
  { name: "QR included food", unit_price: 0 },
  { name: "Buffet per person", unit_price: 399 },
  { name: "Paid add-on", unit_price: 49 },
  { name: "Negative adjustment", unit_price: -20 }
];

describe("billing document policy", () => {
  it("recognizes FF store codes case-insensitively", () => {
    expect(isFfStoreCode("FF0001")).toBe(true);
    expect(isFfStoreCode(" ff0002 ")).toBe(true);
    expect(isFfStoreCode("FG0003")).toBe(false);
  });

  it("removes only zero-priced document lines for FF stores", () => {
    const result = filterBillingDocumentItems(items, "FF0001", (item) => item.unit_price);
    expect(result.map((item) => item.name)).toEqual([
      "Buffet per person",
      "Paid add-on",
      "Negative adjustment"
    ]);
  });

  it("does not change FG0003 or future FG store document lines", () => {
    expect(filterBillingDocumentItems(items, "FG0003", (item) => item.unit_price)).toEqual(items);
    expect(filterBillingDocumentItems(items, "FG0004", (item) => item.unit_price)).toEqual(items);
  });

  it("does not change non-FF or missing store scopes", () => {
    expect(filterBillingDocumentItems(items, "NDL-TH-001", (item) => item.unit_price)).toEqual(items);
    expect(filterBillingDocumentItems(items, null, (item) => item.unit_price)).toEqual(items);
  });

  it("keeps malformed or missing prices fail-safe instead of hiding them", () => {
    const uncertain: Item[] = [
      { name: "missing", unit_price: null },
      { name: "blank", unit_price: "" },
      { name: "malformed", unit_price: "not-a-number" },
      { name: "zero", unit_price: "0" }
    ];
    expect(filterBillingDocumentItems(uncertain, "FF0001", (item) => item.unit_price).map((item) => item.name)).toEqual([
      "missing",
      "blank",
      "malformed"
    ]);
  });
});

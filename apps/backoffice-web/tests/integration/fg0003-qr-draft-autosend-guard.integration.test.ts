import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const salesUi = readFileSync(new URL("../../src/components/pos/pos-sales-module.tsx", import.meta.url), "utf8");

describe("FG0003 QR draft must not arm POS kitchen autosend", () => {
  it("requires an explicit cashier cart mutation before dine-in autosend", () => {
    expect(salesUi).toContain("dineInCashierMutationVersionRef");
    expect(salesUi).toContain("cashierMutationVersion <= committedMutationVersion");
    expect(salesUi).toContain("markDineInCashierCartMutation();");
  });

  it("does not preserve a refresh/hydration cart unless cashier changes are pending", () => {
    expect(salesUi).toContain("const hasPendingCashierMutation =");
    expect(salesUi).toContain("isActiveSelectedTable && hasPendingCashierMutation");
  });

  it("uses a cashier-only request prefix for explicit POS mutations", () => {
    expect(salesUi).toContain("pos-dine-cashier-${tableId}-");
    expect(salesUi).not.toContain("pos-dine-kitchen-${tableId}-");
  });
});

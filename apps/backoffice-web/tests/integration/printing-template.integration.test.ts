import { describe, expect, it } from "vitest";
import { renderReceiptTemplate } from "@/lib/printing/print-service";

describe("printing template generation", () => {
  it("renders receipt template with order and totals", () => {
    const output = renderReceiptTemplate(
      {
        order_id: "00000000-0000-0000-0000-000000000001",
        order_no: "DLV-2026-001",
        branch_name: "SST Noodle Branch A",
        cashier_name: "cashier-01",
        paid_at_iso: "2026-05-18T10:30:00.000Z",
        currency: "THB",
        items: [
          { name: "Pad Thai", qty: 2, unit_price: 80, line_total: 160 },
          { name: "Water", qty: 1, unit_price: 20, line_total: 20 }
        ],
        subtotal: 180,
        discount_amount: 10,
        tax_amount: 11.9,
        total_amount: 181.9,
        payment_method: "cash",
        note: "No spicy"
      },
      58
    );

    expect(output).toContain("CpIPOS");
    expect(output).toContain("?????????");
    expect(output).toContain("DLV-2026");
    expect(output).toContain("Pad Thai");
    expect(output).toContain("??????????????");
    expect(output).toContain("181.90");
    expect(output).toContain("No spicy");
  });
});

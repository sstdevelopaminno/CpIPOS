import { describe, expect, it } from "vitest";
import { renderReceiptHtml } from "@/lib/printing/receipt-html-template";
import { renderReceiptTemplate, resolveReceiptSellerName } from "@/lib/printing/print-service";

describe("printing template generation", () => {
  it("renders receipt template with company header, seller, order and totals", () => {
    const output = renderReceiptTemplate(
      {
        order_id: "00000000-0000-0000-0000-000000000001",
        order_no: "DLV-2026-001",
        store_name: "SST Foods",
        store_address: "99 Test Road Bangkok",
        store_phone: "02-000-0000",
        branch_name: "SST Noodle Branch A",
        cashier_name: "Cashier One",
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

    expect(output).toContain("SST Foods");
    expect(output).toContain("02-000-0000");
    expect(output).toContain("ผู้ขาย");
    expect(output).toContain("Cashier One");
    expect(output).toContain("ใบเสร็จเลขที่");
    expect(output).toContain("DLV-2026");
    expect(output).toContain("Pad Thai");
    expect(output).toContain("ยอดสุทธิ");
    expect(output).toContain("181.90");
    expect(output).toContain("No spicy");
  });

  it("resolves seller display name before falling back to user id", () => {
    expect(resolveReceiptSellerName({ seller_name: "Seller Name", user_id: "u1" })).toBe("Seller Name");
    expect(resolveReceiptSellerName({ full_name: "Full Name", employee_code: "E01", user_id: "u1" })).toBe("Full Name");
    expect(resolveReceiptSellerName({ employee_code: "E01", user_id: "u1" })).toBe("E01");
    expect(resolveReceiptSellerName({ user_id: "u1" })).toBe("u1");
  });

  it("renders receipt html with default CpIPOS logo when no custom logo is set", () => {
    const html = renderReceiptHtml({
      paperWidthMm: 58,
      storeName: "SST Foods",
      branchName: "Branch A",
      storeAddress: "99 Test Road Bangkok",
      storePhone: "02-000-0000",
      logoUrl: null,
      sellerName: "Cashier One",
      orderNo: "POS-1001",
      modeLabel: "หน้าขาย",
      paidAtIso: "2026-05-18T10:30:00.000Z",
      items: [{ name: "Pad Thai", quantity: 1, unitPrice: 80, lineTotal: 80 }],
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 80,
      paymentMethod: "cash",
      cashReceived: 100,
      changeAmount: 20,
      note: null
    });

    expect(html).toContain('/brand/cpipos-logo.png');
    expect(html).toContain("SST Foods");
    expect(html).toContain("99 Test Road Bangkok");
    expect(html).toContain("02-000-0000");
    expect(html).toContain("ผู้ขาย");
    expect(html).toContain("Cashier One");
  });
});

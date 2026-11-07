import { describe, expect, it } from "vitest";
import {
  composePosItemNotes,
  formatPosItemNotesForDisplay,
  parsePosItemNotes,
  splitPosItemOptionNotes
} from "../../src/lib/pos-item-notes";
import { renderReceiptHtml } from "../../src/lib/printing/receipt-html-template";
import { renderKitchenTicketHtml } from "../../src/lib/printing/kitchen-ticket-html-template";

describe("POS per-item details", () => {
  it("keeps recipe selections separate from cashier-entered details", () => {
    const stored = composePosItemNotes("มาม่า instant x1, ไข่ large x1", "ไม่ใส่ผัก\nแยกน้ำ");
    expect(stored).toContain("[[CPIPOS_ITEM_DETAIL]]:");
    expect(stored).not.toContain("ไม่ใส่ผัก");

    expect(parsePosItemNotes(stored)).toEqual({
      optionNotes: "มาม่า instant x1, ไข่ large x1",
      detailNote: "ไม่ใส่ผัก\nแยกน้ำ"
    });
    expect(splitPosItemOptionNotes(stored)).toEqual(["มาม่า instant x1", "ไข่ large x1"]);
    expect(formatPosItemNotesForDisplay(stored, "รายละเอียด")).toBe(
      "มาม่า instant x1, ไข่ large x1\nรายละเอียด: ไม่ใส่ผัก\nแยกน้ำ"
    );
  });

  it("keeps legacy item notes readable", () => {
    expect(parsePosItemNotes("ไม่ใส่ผัก")).toEqual({ optionNotes: "ไม่ใส่ผัก", detailNote: "" });
    expect(formatPosItemNotesForDisplay("ไม่ใส่ผัก")).toBe("ไม่ใส่ผัก");
  });

  it("renders clean item details on canonical receipts", () => {
    const note = composePosItemNotes("ไข่ large x1, หมี่เหลือง yellow x1", "ไม่ใส่ถั่วงอก");
    const html = renderReceiptHtml({
      paperWidthMm: 80,
      languageCode: "th",
      storeName: "Test Store",
      branchName: "Main",
      sellerName: "Cashier",
      orderNo: "DINE-001",
      paidAtIso: "2026-11-07T14:00:00.000Z",
      items: [{ name: "ก๋วยเตี๋ยว", quantity: 1, unitPrice: 70, lineTotal: 70, note }],
      discountAmount: 0,
      totalAmount: 70,
      paymentMethod: "cash",
      cashReceived: 100,
      changeAmount: 30
    });

    expect(html).toContain("+ ไข่ large x1");
    expect(html).toContain("+ หมี่เหลือง yellow x1");
    expect(html).toContain("รายละเอียด");
    expect(html).toContain("ไม่ใส่ถั่วงอก");
    expect(html).not.toContain("[[CPIPOS_ITEM_DETAIL]]");
  });

  it("renders clean item details on kitchen tickets", () => {
    const note = composePosItemNotes("มาม่า instant x1", "แยกน้ำ");
    const html = renderKitchenTicketHtml({
      storeName: "Test Store",
      branchName: "Main",
      zoneName: "Kitchen01",
      zoneCode: "K01",
      queueNo: 1,
      roundNo: 1,
      orderNo: "DINE-001",
      orderType: "dine_in",
      tableLabel: "01",
      ticketId: "ticket-1",
      eventType: "new",
      createdAtIso: "2026-11-07T14:00:00.000Z",
      paperWidthMm: 80,
      items: [{ name: "ก๋วยเตี๋ยว", quantity: 1, notes: note }]
    });

    expect(html).toContain("ตัวเลือก");
    expect(html).toContain("มาม่า instant x1");
    expect(html).toContain("รายละเอียด");
    expect(html).toContain("แยกน้ำ");
    expect(html).not.toContain("[[CPIPOS_ITEM_DETAIL]]");
  });
});

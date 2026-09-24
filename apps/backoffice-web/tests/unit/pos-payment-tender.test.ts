import { describe, expect, it } from "vitest";
import { summarizePosTender } from "@/lib/pos-payment-tender";

describe("POS split-tender authorization and cash handling", () => {
  it("requires transfer verification even when cash is the first line", () => {
    expect(summarizePosTender([
      { method: "cash", amount: 200 },
      { method: "bank_transfer", amount: 300 }
    ], 500)).toEqual({
      hasCash: true, hasBankTransfer: true, cashDue: 200, transferDue: 300,
      cashReceivedAmount: 500, changeAmount: 300
    });
  });
  it("opens the cash path even when transfer is the first line", () => {
    expect(summarizePosTender([
      { method: "bank_transfer", amount: 300 },
      { method: "cash", amount: 200 }
    ], 200)).toMatchObject({
      hasCash: true, hasBankTransfer: true, cashDue: 200, transferDue: 300,
      cashReceivedAmount: 200, changeAmount: 0
    });
  });
  it("does not treat a transfer as cash or generate bank-transfer change", () => {
    expect(summarizePosTender([{ method: "bank_transfer", amount: 1273 }], 1273)).toMatchObject({
      hasCash: false, hasBankTransfer: true, cashDue: 0,
      cashReceivedAmount: 0, changeAmount: 0
    });
  });
  it("defaults cash received to the cash portion, not the mixed payment total", () => {
    expect(summarizePosTender([
      { method: "cash", amount: 50.1 },
      { method: "cash", amount: 49.9 },
      { method: "bank_transfer", amount: 300 }
    ])).toMatchObject({ cashDue: 100, transferDue: 300, cashReceivedAmount: 100, changeAmount: 0 });
  });
});

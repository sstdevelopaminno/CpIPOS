import { describe, expect, it } from "vitest";
import { isConflictErrorCode, localizeApiErrorMessage } from "../../src/components/pos/pos-sales-errors";

describe("POS sales error localization", () => {
  it("localizes stock deduction payment failures in Thai", () => {
    expect(
      localizeApiErrorMessage({
        message: "stock_deduction_failed: new row violates stock policy",
        lang: "th"
      })
    ).toBe("ตัดสต๊อกเพื่อปิดการขายไม่สำเร็จ กรุณาตรวจสอบสต๊อกหรือการตั้งค่าสต๊อกแล้วลองใหม่");
  });

  it("localizes stock deduction payment failures in English", () => {
    expect(
      localizeApiErrorMessage({
        message: "stock_deduction_failed: new row violates stock policy",
        lang: "en"
      })
    ).toBe("Unable to deduct stock while completing payment. Check stock settings and try again.");
  });

  it("localizes financial invariant review failures in English", () => {
    expect(
      localizeApiErrorMessage({
        message: "payment_financial_review_required: ORDER_FINANCIAL_INVARIANT_VIOLATION:TOTAL_GRAND_MISMATCH",
        lang: "en"
      })
    ).toBe("Order financial data is inconsistent. Refresh the bill and request manager review before retrying payment.");
  });

  it("treats financial invariant review as a conflict path", () => {
    expect(isConflictErrorCode("payment_financial_review_required")).toBe(true);
  });
});

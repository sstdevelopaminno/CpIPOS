import { describe, expect, it } from "vitest";
import { localizeApiErrorMessage } from "../../src/components/pos/pos-sales-errors";

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
});

import { describe, expect, it } from "vitest";
import { repairThaiMojibakeText } from "@/components/system/thai-mojibake-recovery";

describe("repairThaiMojibakeText", () => {
  it("repairs common corrupted Thai UI text", () => {
    expect(repairThaiMojibakeText("เธ•เธฑเนเธเธเนเธฒ")).toBe("ตั้งค่า");
    expect(repairThaiMojibakeText("เน€เธเธดเธเธชเธ”")).toBe("เงินสด");
    expect(repairThaiMojibakeText("เธ เธฒเธฉเธฒ")).toBe("ภาษา");
    expect(repairThaiMojibakeText("เธฟ")).toBe("฿");
    expect(repairThaiMojibakeText("โ•")).toBe("↕");
  });

  it("does not alter valid Thai or English text", () => {
    expect(repairThaiMojibakeText("ตั้งค่า")).toBe("ตั้งค่า");
    expect(repairThaiMojibakeText("เธอ")).toBe("เธอ");
    expect(repairThaiMojibakeText("เงินสด")).toBe("เงินสด");
    expect(repairThaiMojibakeText("Print Agents / INET QR / VAT")).toBe("Print Agents / INET QR / VAT");
  });
});

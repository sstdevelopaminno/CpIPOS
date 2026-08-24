import { describe, expect, it } from "vitest";
import { classifyStoreCodeFamily, normalizeStoreCode, storeCodeFamilyLabel } from "@/lib/it-ops-store-family";

describe("IT operations store-code family", () => {
  it("classifies Restaurant QR codes without activating features", () => {
    expect(classifyStoreCodeFamily("FG0003")).toBe("RESTAURANT_QR");
    expect(classifyStoreCodeFamily(" fg0004 ")).toBe("RESTAURANT_QR");
  });

  it("classifies Buffet codes", () => {
    expect(classifyStoreCodeFamily("FF0001")).toBe("BUFFET");
    expect(storeCodeFamilyLabel("FF0123")).toBe("Buffet");
  });

  it("keeps unrelated store codes outside product families", () => {
    expect(classifyStoreCodeFamily("NDL-TH-001")).toBe("OTHER");
    expect(normalizeStoreCode(" abc ")).toBe("ABC");
  });
});

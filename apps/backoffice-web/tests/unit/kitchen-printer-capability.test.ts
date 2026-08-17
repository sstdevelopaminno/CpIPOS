import { describe, expect, it } from "vitest";
import { isKitchenCapablePrinter } from "@/lib/services/kitchen-config-service";

describe("Kitchen printer capability", () => {
  it("accepts the legacy dedicated kitchen role", () => {
    expect(isKitchenCapablePrinter({ printer_role: "kitchen", metadata: {} })).toBe(true);
  });

  it("accepts a receipt-role printer that explicitly supports Kitchen", () => {
    expect(isKitchenCapablePrinter({
      printer_role: "receipt",
      metadata: { capabilities: { receipt: true, kitchen: true } }
    })).toBe(true);
  });

  it("accepts Kitchen in print_functions", () => {
    expect(isKitchenCapablePrinter({
      printer_role: "receipt",
      metadata: { print_functions: ["receipt", "kitchen", "reprint"] }
    })).toBe(true);
  });

  it("rejects a receipt-only printer", () => {
    expect(isKitchenCapablePrinter({
      printer_role: "receipt",
      metadata: { capabilities: { receipt: true }, print_functions: ["receipt"] }
    })).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const s=readFileSync(new URL("../../src/components/pos/pos-general-sale-table-controller.tsx",import.meta.url),"utf8");
describe("shared SD/RW scanner quantity controls",()=>{
  it("puts accessible non-submit buttons on the right, returns focus and preserves manual entry",()=>{
    expect(s).toContain("quantityControls.append(qtyInput, makeStep(-1), makeStep(1))");
    expect(s).toContain('button.type = "button"');
    expect(s).toContain("focusRetailScanner(document, scannerInput, button)");
    expect(s).toContain('qtyInput.inputMode = "numeric"');
    expect(s).toContain("min-height: 44px");
  });
  it("scopes shortcuts to retail fields and never modifies the queued scan quantity",()=>{
    expect(s).toContain("retailQuantityShortcut(event, input.value)");
    expect(s).toContain("scanQueue.push({ code: originalSku, quantity, quantityRevision: acceptedQuantityRevision })");
    expect(s).toContain("nextCode.quantity, nextCode.quantityRevision");
    expect(s).toContain("shouldResetRetailScanQuantity(acceptedQuantityRevision, quantityRevision)");
    expect(s).not.toContain('window.addEventListener("keydown"');
  });
});

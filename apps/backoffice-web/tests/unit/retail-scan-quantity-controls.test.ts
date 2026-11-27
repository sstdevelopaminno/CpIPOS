import { describe, it, expect } from "vitest";
import { retailQuantityShortcut, stepRetailScanQuantity, shouldResetRetailScanQuantity } from "../../src/lib/grocery-scan-input";
const event = (key: string, code: string, extra: Partial<KeyboardEvent> = {}) => ({
  key, code, shiftKey:false, ctrlKey:false, altKey:false, metaKey:false, isComposing:false, ...extra
});
describe("SD/RW next-scan quantity",()=>{
  it("supports keyboard +/- and numpad with a blank scanner field",()=>{
    expect(retailQuantityShortcut(event("+","Equal",{shiftKey:true}),"")).toBe(1);
    expect(retailQuantityShortcut(event("-","Minus"),"")).toBe(-1);
    expect(retailQuantityShortcut(event("+","NumpadAdd"),"")).toBe(1);
    expect(retailQuantityShortcut(event("-","NumpadSubtract"),"")).toBe(-1);
  });
  it("preserves SKU punctuation, Thai numeric layout and modified/composing keys",()=>{
    expect(retailQuantityShortcut(event("-","Minus"),"ABC")).toBeNull();
    expect(retailQuantityShortcut(event("+","Equal",{shiftKey:true}),"ABC")).toBeNull();
    expect(retailQuantityShortcut(event("-","Digit3"),"")).toBeNull();
    expect(retailQuantityShortcut(event("_","Minus",{shiftKey:true}),"")).toBeNull();
    expect(retailQuantityShortcut(event("+","NumpadAdd",{ctrlKey:true}),"")).toBeNull();
    expect(retailQuantityShortcut(event("-","Minus",{isComposing:true}),"")).toBeNull();
  });
  it("steps whole units within 1–9999",()=>{
    expect(stepRetailScanQuantity("1",1)).toBe(2);
    expect(stepRetailScanQuantity("1",-1)).toBe(1);
    expect(stepRetailScanQuantity("9999",1)).toBe(9999);
    expect(stepRetailScanQuantity("5",-1)).toBe(4);
    expect(stepRetailScanQuantity("",1)).toBe(2);
  });
  it("does not reset quantity edited during an earlier async lookup",()=>{
    expect(shouldResetRetailScanQuantity(3,3)).toBe(true);
    expect(shouldResetRetailScanQuantity(3,4)).toBe(false);
  });
});

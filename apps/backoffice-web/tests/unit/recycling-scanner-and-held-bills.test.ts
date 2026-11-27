import { describe, expect, it } from "vitest";
import { normalizeRecyclingBarcodeInput, physicalRecyclingBarcodeKey } from "@/lib/recycling-scanner-keyboard";
import { parseRecyclingHeldBills, recyclingHeldKey } from "@/lib/recycling-held-bills";

describe("Recycling cashier scanner and parked bills isolation",()=>{
 it("decodes Kedmanee numeric SKU independent of Windows input language",()=>{
   expect(normalizeRecyclingBarcodeInput("จจจ")).toBe("000");
   expect(normalizeRecyclingBarcodeInput("P-011/2")).toBe("P-011/2");
   expect(physicalRecyclingBarcodeKey("Digit2",false)).toBe("2");
   expect(physicalRecyclingBarcodeKey("Slash",false)).toBe("/");
   expect(physicalRecyclingBarcodeKey("KeyA",false)).toBe("a");
   expect(physicalRecyclingBarcodeKey("KeyP",true)).toBe("P");
   expect(physicalRecyclingBarcodeKey("Digit0",false)).toBe("0");
   expect(physicalRecyclingBarcodeKey("Numpad5",false)).toBe("5");
   expect(physicalRecyclingBarcodeKey("Enter",false)).toBeNull();
 });
 it("isolates drafts to tenant, branch, terminal and shift",()=>{
   const key=recyclingHeldKey("a","b","c","d");
   expect(key).not.toBe(recyclingHeldKey("a","b","other","d"));
   expect(key).not.toBe(recyclingHeldKey("other","b","c","d"));
   expect(key).not.toBe(recyclingHeldKey("a","b","c","other"));
 });
 it("discards corrupted or cross-shift held bill snapshots",()=>{
   const shiftId="11111111-1111-4111-8111-111111111111";
   const draft={id:"22222222-2222-4222-8222-222222222222",
      shiftId,direction:"buy",heldAt:new Date().toISOString(),lines:[
      {productId:"33333333-3333-4333-8333-333333333333",unit:"kg",quantity:5,unitPrice:3.55}
   ]};
   expect(parseRecyclingHeldBills(JSON.stringify([draft]),shiftId)).toHaveLength(1);
   expect(parseRecyclingHeldBills(JSON.stringify([draft]),"44444444-4444-4444-8444-444444444444")).toHaveLength(0);
   expect(parseRecyclingHeldBills("not-json",shiftId)).toHaveLength(0);
   const documentOverride={time:"2026-11-25T08:09:10",reason:"Historical test purchase"};
   expect(parseRecyclingHeldBills(JSON.stringify([{...draft,documentOverride}]),shiftId)[0]?.documentOverride).toEqual(documentOverride);
   expect(parseRecyclingHeldBills(JSON.stringify([{...draft,documentOverride:{time:"bad",reason:"x"}}]),shiftId)).toHaveLength(0);
 });
});

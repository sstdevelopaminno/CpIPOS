import { describe, expect, it } from "vitest";
import { isRetailWholesaleProfile, resolveRetailRuntimeModes } from "../../src/lib/retail-wholesale/profile";
import { quoteRetailWholesale } from "../../src/lib/retail-wholesale/pricing";
describe("RW profile isolation", () => {
  it("requires explicit CUSTOM RW independent of SD, with legacy dual-flag compatibility", () => {
    const modes = { retail_wholesale: true, general_sale: true };
    expect(isRetailWholesaleProfile("custom", modes)).toBe(true);
    for (const pkg of ["starter","growth","business",null]) expect(isRetailWholesaleProfile(pkg, modes)).toBe(false);
    expect(isRetailWholesaleProfile("custom",{general_sale:true})).toBe(false);
    expect(isRetailWholesaleProfile("custom",{retail_wholesale:true,general_sale:false})).toBe(true);
    expect(isRetailWholesaleProfile("custom",{retail_wholesale:true})).toBe(true);
    expect(isRetailWholesaleProfile("custom",{...modes,recycling:true})).toBe(false);
    expect(isRetailWholesaleProfile("custom",{...modes,optical_retail:true})).toBe(false);
    expect(isRetailWholesaleProfile("custom",{...modes,dine_in:true})).toBe(false);
    expect(isRetailWholesaleProfile("custom",{...modes,retail_wholesale:"true"})).toBe(false);
  });
});
describe("RW runtime projection",()=>{
  it("uses SD engine without altering the selected licence",()=>{
    const raw={retail_wholesale:true,general_sale:false};
    expect(resolveRetailRuntimeModes("custom",raw,raw).general_sale).toBe(true);
    expect(raw.general_sale).toBe(false);
    expect(resolveRetailRuntimeModes("growth",raw,raw).general_sale).toBe(false);
    expect(resolveRetailRuntimeModes("custom",{...raw,recycling:true},raw).general_sale).toBe(false);
  });
});
const sample = { retailPriceSatang: 1000, units: [{code:"piece",baseUnits:1},{code:"case",baseUnits:12}], tiers: [{minBaseUnits:12,unitPriceSatang:900},{minBaseUnits:24,unitPriceSatang:800}], unitCode:"case",quantity:2,priceMode:"wholesale" as const };
describe("RW isolated tier price and unit calculations", () => {
  it("chooses the highest eligible threshold and converts stock units", () => {
    expect(quoteRetailWholesale(sample)).toEqual({baseQuantity:24,unitPriceSatang:800,lineTotalSatang:19200,appliedTier:24});
  });
  it("keeps retail pricing separate and falls back below the threshold", () => {
    expect(quoteRetailWholesale({...sample,priceMode:"retail"}).lineTotalSatang).toBe(24000);
    expect(quoteRetailWholesale({...sample,unitCode:"piece",quantity:1}).appliedTier).toBeNull();
  });
  it("rejects invalid conversions, duplicate thresholds and unsafe totals", () => {
    expect(()=>quoteRetailWholesale({...sample,quantity:0})).toThrow();
    expect(()=>quoteRetailWholesale({...sample,unitCode:"unknown"})).toThrow();
    expect(()=>quoteRetailWholesale({...sample,units:[{code:"case",baseUnits:1.5}]})).toThrow();
    expect(()=>quoteRetailWholesale({...sample,tiers:[...sample.tiers,sample.tiers[0]]})).toThrow();
    expect(()=>quoteRetailWholesale({...sample,quantity:Number.MAX_SAFE_INTEGER})).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { explicitRetailPrice, estimateRetailStockCost } from "../../src/lib/retail-wholesale/stock-display";
describe("RW stock prices",()=>{
  it("does not replace unconfigured prices with retail price or zero",()=>{
    for(const x of [null,undefined,"",false,"abc",-1])expect(explicitRetailPrice(x)).toBeNull();
    expect(explicitRetailPrice("25.50")).toBe(25.5);
    expect(explicitRetailPrice(0)).toBe(0);
  });
  it("calculates only complete known average cost",()=>{
    expect(estimateRetailStockCost([{quantity:2,cost:4.5},{quantity:1,cost:2}])).toBe(11);
    expect(estimateRetailStockCost([])).toBeNull();
    expect(estimateRetailStockCost([{quantity:1,cost:0}])).toBeNull();
    expect(estimateRetailStockCost([{quantity:1,cost:5},{quantity:1,cost:null}])).toBeNull();
  });
});

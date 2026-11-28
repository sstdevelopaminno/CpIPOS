import { describe,it,expect } from "vitest";
import { parseRetailPriceSetting } from "../../src/lib/retail-wholesale/stock-display";
describe("RW price settings",()=>{
  it("preserves null and accepts valid currency",()=>{
    expect(parseRetailPriceSetting(null)).toEqual({ok:true,value:null});
    expect(parseRetailPriceSetting("")).toEqual({ok:true,value:null});
    expect(parseRetailPriceSetting("123.45")).toEqual({ok:true,value:123.45});
    expect(parseRetailPriceSetting(0)).toEqual({ok:true,value:0});
  });
  it("rejects invalid prices rather than coercing",()=>{
    for(const v of [false,undefined,-1,"-1","1.234","1e3",{},Infinity])expect(parseRetailPriceSetting(v)).toEqual({ok:false});
  });
});

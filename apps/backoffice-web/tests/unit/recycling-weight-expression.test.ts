import {describe,it,expect} from "vitest";
import {parseRecyclingWeightExpression as parse} from "../../src/lib/recycling-weight-expression";
import {calculateRecyclingLine} from "../../src/lib/recycling-calculation";
describe("Recycling cashier weight addition",()=>{
  it("adds repeated scale readings and accepts a pasted equals sign",()=>{
    expect(parse("30+30+56","kg")).toEqual({quantity:116,display:"116"});
    expect(parse("30 + 30 + 56 =","kg")).toEqual({quantity:116,display:"116"});
    expect(parse("116","kg")).toEqual({quantity:116,display:"116"});
    expect(parse("30.25+30.75+56.5","kg")).toEqual({quantity:117.5,display:"117.5"});
    expect(parse("0.1+0.2","kg")).toEqual({quantity:0.3,display:"0.3"});
    expect(parse(".5 + 0.500000","kg")).toEqual({quantity:1,display:"1"});
    expect(parse("30.+30","kg")).toEqual({quantity:60,display:"60"});
  });
  it("preserves the configured unit and exact existing cart pricing",()=>{
    for(const unit of ["kg","khid","g","ton"] as const){
      const result=parse("30+30+56",unit);
      expect(result?.quantity).toBe(116);
      expect(calculateRecyclingLine(result!.quantity,unit,20,"kg")).toEqual(calculateRecyclingLine(116,unit,20,"kg"));
    }
    expect(calculateRecyclingLine(parse("30+30+56","kg")!.quantity,"kg",12.5,"kg")).toEqual({amount:1450,basisQuantity:116});
    expect(parse("1+2","piece")).toBeNull();
  });
  it("rejects incomplete, negative, unsupported and over-limit expressions",()=>{
    for(const raw of ["","30+","30++56","30+abc","30-10","30*2","30/2","30+(-2)","1e2","1,000","30=+20","30==","0","0.0001","0.0000001+1","100000001","1+".repeat(64)+"1"," ".repeat(513)+"1"]){
      expect(parse(raw,"kg"),raw).toBeNull();
    }
    expect(parse("100000000","kg")?.quantity).toBe(100000000);
    expect(parse("99999999+2","kg")).toBeNull();
    expect(parse("1.0001","g")).toBeNull();
  });
});

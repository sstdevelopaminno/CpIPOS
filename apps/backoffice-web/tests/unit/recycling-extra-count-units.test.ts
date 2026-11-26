import {describe,it,expect} from "vitest";
import {calculateRecyclingLine,recyclingUnitLabel} from "../../src/lib/recycling-calculation";
import {getRecyclingPriceBasis,parseRecyclingUnitPrice,formatRecyclingUnitPrice,RECYCLING_PRICE_UNIT_LABELS} from "../../src/lib/recycling-price-units";
import {readLine} from "../../src/lib/recycling-transaction-input";
describe("Additional counted units",()=>{
 for(const [unit,label] of [["vehicle","คัน"],["set","ชุด"],["unit","ตัว"],["machine","เครื่อง"],["cabinet","ตู้"]] as const){
  it("supports "+label+" in count-based pricing and checkout",()=>{
   expect(RECYCLING_PRICE_UNIT_LABELS[unit]).toBe(label);
   expect(recyclingUnitLabel(unit)).toBe(label);
   expect(getRecyclingPriceBasis(unit)).toBe("piece");
   expect(parseRecyclingUnitPrice("125.50",unit)).toBe(125.5);
   expect(formatRecyclingUnitPrice(125.5,unit)).toBe("125.5");
   expect(calculateRecyclingLine(3,unit,125.5,"piece")).toEqual({amount:376.5,basisQuantity:3});
   expect(calculateRecyclingLine(1.5,unit,125.5,"piece")).toBeNull();
   expect(calculateRecyclingLine(3,unit,125.5,"kg")).toBeNull();
   const row={product_id:"12345678-1234-4234-8234-123456789abc",unit,quantity:3,expected_price:125.5};
   expect(readLine(row)).toEqual(row);
   expect(readLine({...row,quantity:1.5})).toBeNull();
  });
 }
});

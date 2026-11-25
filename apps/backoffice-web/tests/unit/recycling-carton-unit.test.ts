import {describe,it,expect} from "vitest";
import {calculateRecyclingLine,recyclingUnitLabel} from "../../src/lib/recycling-calculation";
import {formatRecyclingUnitPrice,parseRecyclingUnitPrice,getRecyclingPriceBasis} from "../../src/lib/recycling-price-units";
import {readLine} from "../../src/lib/recycling-transaction-input";
describe("Recycling whole-carton SKU",()=>{
 it("uses one whole carton as one count with price in THB/carton",()=>{
  expect(recyclingUnitLabel("carton")).toBe("ลัง");
  expect(getRecyclingPriceBasis("carton")).toBe("piece");
  expect(parseRecyclingUnitPrice("125.50","carton")).toBe(125.5);
  expect(formatRecyclingUnitPrice(125.5,"carton")).toBe("125.5");
  expect(calculateRecyclingLine(3,"carton",125.5,"piece")).toEqual({amount:376.5,basisQuantity:3});
  expect(calculateRecyclingLine(1.5,"carton",125.5,"piece")).toBeNull();
  expect(calculateRecyclingLine(3,"carton",125.5,"kg")).toBeNull();
  const line={product_id:"12345678-1234-4234-8234-123456789abc",unit:"carton",quantity:3,expected_price:125.5};
  expect(readLine(line)).toEqual(line);
  expect(readLine({...line,quantity:1.5})).toBeNull();
 });
});

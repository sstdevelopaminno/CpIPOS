import {describe,it,expect} from "vitest";
import {isCustomRecyclingUnit,priceUnitLabel,getRecyclingPriceBasis,parseRecyclingUnitPrice,formatRecyclingUnitPrice} from "../../src/lib/recycling-price-units";
import {calculateRecyclingLine} from "../../src/lib/recycling-calculation";
import {readLine} from "../../src/lib/recycling-transaction-input";
describe("custom counted price units",()=>{
 it("preserves exact amount and label",()=>{
  const unit="custom:แพ็ก";
  expect(isCustomRecyclingUnit(unit)).toBe(true);
  expect(priceUnitLabel(unit)).toBe("แพ็ก");
  expect(getRecyclingPriceBasis(unit)).toBe("piece");
  expect(parseRecyclingUnitPrice("125.50",unit)).toBe(125.5);
  expect(formatRecyclingUnitPrice(125.5,unit)).toBe("125.5");
  expect(calculateRecyclingLine(3,unit,125.5,"piece")).toEqual({amount:376.5,basisQuantity:3});
  expect(calculateRecyclingLine(1.5,unit,125.5,"piece")).toBeNull();
  expect(readLine({product_id:"12345678-1234-4234-8234-123456789abc",unit,quantity:3,expected_price:125.5})).not.toBeNull();
  for(const invalid of ["custom:","custom:<script>","custom:abc ","custom:"+"a".repeat(25)])expect(isCustomRecyclingUnit(invalid)).toBe(false);
 });
});

import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const source=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("Recycling cashier weight calculation controls",()=>{
 it("calculates in place without adding to the cart until confirmation",()=>{
  const c=source("src/components/pos/recycling-pos-workspace.tsx");
  expect(c).toContain('type={weightedQuantity?"text":"number"}');
  expect(c).toContain('if(event.key==="Enter")');
  expect(c).toContain('event.currentTarget.value');
  expect(c).toContain('event.key==="="||event.code==="NumpadEqual"');
  expect(c).toContain("if(result)setQuantity(result.display)");
  expect(c).toContain("parseRecyclingWeightExpression(raw,unit)?.quantity");
  expect(c).toContain("addLineToCart(pending,unit,resolved,selectedPrice)");
  expect(c).toContain("quantityCommittedRef.current=true");
  expect(c).toContain("scannerRef.current?.focus()");
  expect(c).toContain('pending||checkoutOpen||heldOpen||cancelOpen');
  expect(source("src/components/pos/pos-legacy-sales-content.tsx")).not.toContain("parseRecyclingWeightExpression");
 });
});

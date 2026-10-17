import { describe, expect, it } from "vitest";
import { evaluateOpticalStockCutover } from "@/lib/optical/optical-stock-cutover-readiness";

const ready={
 customOpticalApproved:true,
 salesCurrency:"LAK",
 recipeLinks:0,
 unsettledOrderLines:0,
 opticalBinCount:0,
 reconciledOnHand:8,
 productPrice:20000,
 approvedOpticalPrice:20000
};

describe("no-double-deduction Optical stock migration preflight",()=>{
 it("refuses a legacy QA product while queued orders and recipes remain",()=>{
   const result=evaluateOpticalStockCutover({...ready,recipeLinks:1,unsettledOrderLines:2});
   expect(result.ok).toBe(false);
   expect(result.issues).toContain("legacy_recipe_attached");
   expect(result.issues).toContain("unsettled_orders");
 });
 it("never silently re-uses old currency prices or unverified stock",()=>{
   const result=evaluateOpticalStockCutover({
     ...ready,salesCurrency:"THB",reconciledOnHand:null,approvedOpticalPrice:null
   });
   expect(result.issues).toEqual(expect.arrayContaining([
     "currency_not_lak","source_quantity_not_verified","requires_separate_price_approval"
   ]));
 });
 it("refuses a second bin or unauthorized optical mode",()=>{
   const result=evaluateOpticalStockCutover({
     ...ready,customOpticalApproved:false,opticalBinCount:1
   });
   expect(result.issues).toContain("not_custom_optical");
   expect(result.issues).toContain("existing_optical_bin");
 });
 it("allows cutover only after all independent financial and stock checks pass",()=>{
   expect(evaluateOpticalStockCutover(ready)).toEqual({ok:true,issues:[]});
 });
});

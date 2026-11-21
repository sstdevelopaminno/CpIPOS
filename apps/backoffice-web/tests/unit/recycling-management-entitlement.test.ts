import {describe,expect,it} from "vitest";
import {hasCustomRecyclingManagementMenuGrant} from "@/lib/custom-sales-entitlements";

const grant=(overrides:Record<string,unknown>={})=>hasCustomRecyclingManagementMenuGrant({
 packageCode:"custom",rawModes:{general_sale:false,recycling:true},
 featureCode:"branch_management",menuEnabled:true,explicitFeatureOverride:false,...overrides
});
describe("CUSTOM Recycling management entitlement",()=>{
 it("recognizes only an explicit CUSTOM Recycling mode and IT menu approval",()=>{
  expect(grant()).toBe(true);
  expect(grant({featureCode:"user_management"})).toBe(true);
  expect(grant({featureCode:"stock_management"})).toBe(false);
  expect(grant({menuEnabled:false})).toBe(false);
  expect(grant({packageCode:"growth"})).toBe(false);
  expect(grant({rawModes:{recycling:false,general_sale:true}})).toBe(false);
  expect(grant({rawModes:{}})).toBe(false);
 });
 it("does not override explicitly denied tenant/branch features",()=>{
  expect(grant({explicitFeatureOverride:true})).toBe(false);
 });
});

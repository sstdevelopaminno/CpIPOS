import { describe,expect,it } from "vitest";
import { recyclingVatBlockers,recyclingVatBlockerMessage,validVatRule } from "../../src/lib/recycling-vat-readiness";
describe("Recycling VAT release readiness",()=>{
  it("reports every independent blocker instead of masking missing registration and chart",()=>{
    const blockers=recyclingVatBlockers({configured:true,rollout:false,ruleValid:true,verified:false,accountReady:false});
    expect(blockers).toEqual(["recycling_vat_registration_not_verified","recycling_vat_account_not_ready"]);
    expect(blockers.every(code=>recyclingVatBlockerMessage(code).length>0)).toBe(true);
  });
  it("allows explicitly non-VAT branches and verified VAT without a separate release gate",()=>{
    expect(recyclingVatBlockers({configured:false,rollout:false,ruleValid:false,verified:false,accountReady:false})).toEqual([]);
    expect(recyclingVatBlockers({configured:true,rollout:false,ruleValid:true,verified:true,accountReady:true})).toEqual([]);
    expect(recyclingVatBlockers({configured:true,rollout:true,ruleValid:false,verified:true,accountReady:true})).toEqual(["recycling_vat_settings_unsupported"]);
  });
});

it("recognizes only the supported configured VAT rule",()=>{
 const line={label:"VAT",mode:"add_to_bill",rate_pct:7,is_active:true};
 expect(validVatRule({lines:[line]})).toBe(true);
 expect(validVatRule({lines:[line,{...line}]})).toBe(false);
 expect(validVatRule({lines:[{...line,mode:"included"}]})).toBe(false);
 expect(validVatRule(null)).toBe(false);
});

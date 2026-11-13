import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(file:string)=>readFileSync(resolve(process.cwd(),"src",file),"utf8");
const center=src("components/pos-preview/pos-subscription-center.tsx");
const service=src("lib/services/pos-subscription-center-service.ts");
const submit=src("app/api/pos/billing/requests/route.ts");

describe("POS customer discounts",()=>{
  it("reads only the current tenant's approved promotions",()=>{
    expect(service).toContain('from("tenant_package_discounts")');
    expect(service).toContain('.eq("tenant_id",tenantId)');
    expect(service).toContain('.eq("status","active")');
    expect(service).toContain("row.package_id === contract?.package_id");
    expect(service).toContain("activeDiscount.valid_from");
    expect(service).toContain("activeDiscount.valid_until");
  });

  it("shows the owner savings while respecting the canonical amount due",()=>{
    expect(center).toContain("แจ้งสิทธิส่วนลดแพ็กเกจ");
    expect(center).toContain("snapshot.promotion.percent");
    expect(center).toContain("snapshot.promotion.regular_amount");
    expect(center).toContain("snapshot.promotion.discounted_amount");
    expect(center).toContain("snapshot.promotion.reflected_in_current_due");
    expect(center).toContain("ติดต่อฝ่ายบริการก่อนชำระเงิน");
  });

  it("does not discount addons, upgrades or an existing payment request",()=>{
    expect(submit).toContain('rpc("tenant_discount_quote"');
    expect(submit).toContain('!upgrading && !isAiAddon');
    expect(submit).toContain('target.id === snapshot.contract.package_id');
    expect(submit).toContain('billingInterval === snapshot.contract.billing_interval');
    expect(submit).toContain("canonicalCurrentAmount");
  });
});
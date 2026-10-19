import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const read=(name:string)=>readFileSync(new URL("../../src/"+name,import.meta.url),"utf8");
describe("CUSTOM Optical tenant IT API revocation",()=>{
  it("requires deployment rollout, one valid CUSTOM Optical contract and per-tenant IT API switch",()=>{
    const policy=read("lib/server/optical-finance-policy.ts");
    expect(policy).toContain('process.env.OPTICAL_FINANCE_V1_ENABLED !== "true"');
    expect(policy).toContain('contracts.length !== 1');
    expect(policy).toContain('customFeatures?.[feature] !== true');
    expect(policy).toContain('.eq("tenant_id",tenantId).eq("menu_key",control)');
    expect(policy).toContain('return !error && data?.is_enabled !== false');
    for(const key of ["settings.crm_optical_api_work_orders","settings.crm_optical_api_deposits",
      "settings.crm_optical_api_inventory","settings.crm_optical_api_customers",
      "settings.crm_optical_api_payment_verification"])expect(policy).toContain(key);
  });
  it("blocks direct customer and inventory endpoints, independently of navigation",()=>{
    for(const path of [
      "app/api/pos/optical/customers/route.ts",
      "app/api/pos/optical/catalog/route.ts",
      "app/api/pos/optical/best-sellers/route.ts"
    ])expect(read(path)).toContain("isOpticalItApiControlAllowed(");
    expect(read("app/api/pos/optical/customers/route.ts")).toContain("optical_customer_it_disabled");
    expect(read("app/api/pos/optical/catalog/route.ts")).toContain("optical_inventory_it_disabled");
  });
  it("blocks transfers when IT revokes verification without accepting browser confirmation as bank proof",()=>{
    for(const path of [
      "app/api/pos/optical/deposits/route.ts",
      "app/api/pos/optical/work-orders/[workOrderId]/payments/route.ts"
    ]){
      const route=read(path);
      expect(route).toContain("isOpticalItApiControlAllowed(scope.session.tenant_id,OPTICAL_IT_API_CONTROLS.optical_payment_verification)");
      expect(route).toContain("optical_transfer_it_disabled");
      expect(route).toContain('role!=="owner"&&role!=="manager"');
      expect(route).toContain("manager_verified");
    }
  });
});

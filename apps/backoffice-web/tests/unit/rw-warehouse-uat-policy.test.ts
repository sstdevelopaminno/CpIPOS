import {describe,it,expect} from "vitest";
import {rwWarehouseUatAllowed} from "../../src/lib/retail-wholesale/warehouse-uat-policy";
describe("RW warehouse UAT release fence",()=>{
 const config={VERCEL_ENV:"preview",RW_WAREHOUSE_UAT_ENABLED:"true",RW_WAREHOUSE_UAT_TENANT_ID:"test"};
 it("requires preview, explicit switch and exact tenant",()=>{
  expect(rwWarehouseUatAllowed("test",config)).toBe(true);
  expect(rwWarehouseUatAllowed("other",config)).toBe(false);
  expect(rwWarehouseUatAllowed("test",{...config,VERCEL_ENV:"production"})).toBe(false);
  expect(rwWarehouseUatAllowed("test",{...config,RW_WAREHOUSE_UAT_ENABLED:"false"})).toBe(false);
  expect(rwWarehouseUatAllowed("test",{})).toBe(false);
 });
});

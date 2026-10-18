import {beforeEach,describe,expect,it,vi} from "vitest";
const service=vi.hoisted(()=>({db:vi.fn()}));
vi.mock("@/lib/supabase-admin",()=>({getSupabaseServiceClient:service.db}));
import {isOpticalItApiControlAllowed,OPTICAL_IT_API_CONTROLS} from "@/lib/server/optical-finance-policy";

function mockPolicy(result:{data:{is_enabled:boolean}|null,error:null|{message:string}}) {
  const maybeSingle=vi.fn().mockResolvedValue(result);
  const eqMenu=vi.fn().mockReturnValue({maybeSingle});
  const eqTenant=vi.fn().mockReturnValue({eq:eqMenu});
  const select=vi.fn().mockReturnValue({eq:eqTenant});
  const from=vi.fn().mockReturnValue({select});
  service.db.mockReturnValue({from});
  return {from,eqTenant,eqMenu};
}
describe("Optical finance IT tenant API kill-switch backend behavior",()=>{
  beforeEach(()=>vi.resetAllMocks());
  it("explicit disabled tenant policy revokes API rather than hiding a UI link",async()=>{
    const c=mockPolicy({data:{is_enabled:false},error:null});
    await expect(isOpticalItApiControlAllowed("tenant-a",OPTICAL_IT_API_CONTROLS.optical_deposit)).resolves.toBe(false);
    expect(c.from).toHaveBeenCalledWith("tenant_pos_menu_policies");
    expect(c.eqTenant).toHaveBeenCalledWith("tenant-a");
    expect(c.eqMenu).toHaveBeenCalledWith("settings.crm_optical_api_deposits");
  });
  it("allows a switch only when enabled or absent, without granting package permissions",async()=>{
    mockPolicy({data:{is_enabled:true},error:null});
    await expect(isOpticalItApiControlAllowed("tenant-a",OPTICAL_IT_API_CONTROLS.optical_work_orders)).resolves.toBe(true);
    mockPolicy({data:null,error:null});
    await expect(isOpticalItApiControlAllowed("tenant-b",OPTICAL_IT_API_CONTROLS.optical_inventory)).resolves.toBe(true);
  });
  it("database policy query failure must be denied",async()=>{
    mockPolicy({data:null,error:{message:"database unavailable"}});
    await expect(isOpticalItApiControlAllowed("tenant-a",OPTICAL_IT_API_CONTROLS.optical_payment_verification)).resolves.toBe(false);
  });
});

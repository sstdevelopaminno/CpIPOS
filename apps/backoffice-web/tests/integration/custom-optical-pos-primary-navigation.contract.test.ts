import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
import {POS_MENU_CATALOG,posMenuKeyForRoute,isCustomPosMenuVisible} from "../../src/lib/pos-menu-policy";
const read=(name:string)=>readFileSync(resolve(process.cwd(),"src",name),"utf8");
describe("CUSTOM Optical first-class POS menus and branch-scoped customer/work-order reuse",()=>{
  it("registers the two top-level routes in the same policy keys used by IT",()=>{
    expect(posMenuKeyForRoute("/preview/pos/optical/customers")).toBe("main.optical_customers");
    expect(posMenuKeyForRoute("/preview/pos/optical/work-orders")).toBe("main.optical_work_orders");
    expect(POS_MENU_CATALOG.filter(x=>x.key.startsWith("main.optical_"))).toHaveLength(2);
    expect(isCustomPosMenuVisible("main.optical_customers",{},true)).toBe(false);
    expect(isCustomPosMenuVisible("main.optical_work_orders",{},true)).toBe(false);
    expect(isCustomPosMenuVisible("main.optical_customers",{"main.optical_customers":true},true)).toBe(true);
    expect(isCustomPosMenuVisible("main.optical_work_orders",{"main.optical_work_orders":false},true)).toBe(false);
  });
  it("shows both only when CUSTOM Optical active; staff uses same menu, not separate checkout",()=>{
    const shell=read("components/pos-preview/pos-shell-sidebar.tsx");
    const staff=read("components/pos-preview/pos-staff-menu.tsx");
    expect(shell).toContain('body?.data?.sales_modes?.optical_retail === true');
    expect(shell).toContain("opticalMenuAllowed={opticalMenuAllowed}");
    expect(staff).toContain('href:"/preview/pos/optical/customers"');
    expect(staff).toContain('href:"/preview/pos/optical/work-orders"');
    expect(staff).toContain('roles:["owner","manager","staff"]');
    expect(staff).toContain('|| opticalMenuAllowed');
    expect(staff).toContain('isCustomPosMenuVisible(posMenuKeyForRoute(item.href) ?? "", menuPolicy, true)');
    expect(staff).not.toContain('href:"/preview/pos/optical/checkout"');
  });
  it("server pages guard IT CUSTOM menu, Optical contract and POS permission",()=>{
    for(const page of ["app/preview/pos/optical/customers/page.tsx","app/preview/pos/optical/work-orders/page.tsx"]){
      const src=read(page);
      expect(src).toContain('await requirePosSession()');
      expect(src).toContain('requirePermission(scope,"sales:list:view")');
      expect(src).toContain('requireOpticalRetailEntitlement(scope.session.tenant_id)');
      expect(src).toContain('assertPosMenuPageAllowed(scope.session.tenant_id,');
    }
  });
  it("customer main page uses exact same customer/exam modal and API as sales page",()=>{
    const customer=read("components/pos/pos-optical-customers-workspace.tsx");
    const existing=read("components/pos/pos-sales-module.tsx");
    const modal=read("components/pos/pos-optical-customer-modal.tsx");
    const api=read("app/api/pos/optical/customers/route.ts");
    expect(customer).toContain('<PosOpticalCustomerModal open={open}');
    expect(existing).toContain("<PosOpticalCustomerModal");
    expect(customer).toContain('fetch("/api/pos/optical/customers"');
    expect(modal).toContain('fetch("/api/pos/optical/customers"');
    expect(api).toContain('.eq("tenant_id",scope.session.tenant_id)');
    expect(api).toContain('.eq("branch_id",scope.session.branch_id)');
    expect(api).toContain('rpc("optical_save_customer_exam"');
  });
  it("job overview is branch-private read-only, no deposit or inventory writes",()=>{
    const api=read("app/api/pos/optical/work-orders/overview/route.ts");
    const view=read("components/pos/pos-optical-work-orders-workspace.tsx");
    expect(api).toContain('requirePermission(scope,"sales:list:view")');
    expect(api).toContain('requireOpticalRetailEntitlement(scope.session.tenant_id)');
    expect(api).toContain('.eq("tenant_id",tenantId).eq("branch_id",branchId)');
    expect(api).toContain('client.from("optical_work_orders")');
    expect(api).toContain('client.from("optical_customers")');
    expect(api).toContain('Cache-Control","private, no-store"');
    expect(api).not.toContain("optical_post_deposit_tx");
    expect(api).not.toContain("optical_create_work_order_tx");
    expect(view).toContain('fetch("/api/pos/optical/work-orders/overview"');
    expect(view).not.toContain('method:"POST"');
  });
});

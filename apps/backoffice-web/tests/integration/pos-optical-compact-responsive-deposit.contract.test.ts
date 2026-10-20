import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {resolveOpticalDeposit,sanitizeOpticalDepositInput} from "../../src/lib/optical-deposit-amount";

const read=(p:string)=>readFileSync(new URL("../../src/"+p,import.meta.url),"utf8");
describe("CUSTOM Optical responsive POS and safe deposit UI",()=>{
 it("validates deposit amount independently from full sale total",()=>{
  expect(resolveOpticalDeposit("5000",20000,"LAK")).toBe(5000);
  expect(resolveOpticalDeposit("20000",20000,"LAK")).toBe(20000);
  expect(resolveOpticalDeposit("20001",20000,"LAK")).toBeNull();
  expect(resolveOpticalDeposit("0",20000,"LAK")).toBeNull();
  expect(resolveOpticalDeposit("-1",20000,"LAK")).toBeNull();
  expect(resolveOpticalDeposit("10.1",100,"LAK")).toBeNull();
  expect(resolveOpticalDeposit("10.25",100,"USD")).toBe(10.25);
  expect(resolveOpticalDeposit("10.251",100,"USD")).toBeNull();
  expect(resolveOpticalDeposit("NaN",100,"USD")).toBeNull();
  expect(sanitizeOpticalDepositInput("00012.99","LAK")).toBe("12");
  expect(sanitizeOpticalDepositInput("00012.999","THB")).toBe("12.99");
 });
 it("limits the five-column optical cart while keeping generic eight-column carts intact",()=>{
  const source=read("components/pos/pos-general-sale-table-controller.tsx");
  expect(source).toContain("opticalActive ? copy.headers.slice(3) : copy.headers");
  expect(source).toContain("opticalActive ? fullClasses.slice(3) : fullClasses");
  expect(source).toContain("if (opticalActive) tr.append(nameCell, qtyCell, unitPriceCell, totalCell, actionCell)");
  expect(source).toContain("else tr.append(indexCell, skuCell, categoryCell, nameCell, qtyCell, unitPriceCell, totalCell, actionCell)");
  expect(source).toContain('html[${OPTICAL_ACTIVE_ROOT_ATTRIBUTE}="1"] .cpipos-sd-table table');
  expect(source).toContain('orientation: landscape');
 });
 it("shows a two-line full-name tooltip and fixed-size Optical quantity stepper on compact screens",()=>{
  const source=read("components/pos/pos-general-sale-table-controller.tsx");
  expect(source).toContain("productName.title = row.name");
  expect(source).toContain("if (opticalActive) {");
  expect(source).toContain("-webkit-line-clamp: 2");
  expect(source).toContain('html[${OPTICAL_ACTIVE_ROOT_ATTRIBUTE}="1"] .cpipos-sd-table__qty { width: 104px; }');
  expect(source).toContain("width: 104px; max-width: 100%");
  expect(source).toContain("overflow-x: hidden; overflow-y: auto");
  expect(source).toContain("const colgroup = document.createElement(\"colgroup\")");
  expect(source).toContain("grid-template-columns: 34px minmax(28px, 1fr) 34px");
  expect(source).toContain("width: 34px; height: 32px");
  expect(source).toContain('html[${OPTICAL_ACTIVE_ROOT_ATTRIBUTE}="1"] .cpipos-sd-table__money');
  expect(source).toContain('html[${OPTICAL_ACTIVE_ROOT_ATTRIBUTE}="1"] .cpipos-sd-table__actions { width: 40px; }');
  expect(source).toContain('html[${OPTICAL_ACTIVE_ROOT_ATTRIBUTE}="1"] .cpipos-sd-table__qty { width: 104px; }');
  expect(source).toContain("invokeCartAction(index, action)");
  expect(source).toContain('decrease.setAttribute("aria-label", `${copy.decrease} ${row.name}`)');
  expect(source).toContain('increase.setAttribute("aria-label", `${copy.increase} ${row.name}`)');
  expect(source).toContain("remove.setAttribute(\"aria-label\", `${copy.remove} ${row.name}`)");
  expect(source).toContain("else tr.append(indexCell, skuCell, categoryCell, nameCell, qtyCell, unitPriceCell, totalCell, actionCell)");
 });
 it("makes stock vertically scrollable without removing branch permissions or stock verification",()=>{
  const source=read("components/pos/optical-stock-workspace.tsx");
  expect(source).toContain('data-testid="custom-optical-inventory"');
  expect(source).toContain("overflow-y-auto overscroll-y-contain");
  expect(source).toContain('aria-label={T("รายการสต๊อก Optical")}');
  expect(source).toContain("sticky top-0 z-10");
  expect(source).toContain("remaining(row)");
 });
 it("keeps the primary checkout reachable on short tablet landscapes without changing other modes",()=>{
  const controller=read("components/pos/pos-general-sale-table-controller.tsx");
  const viewport=read("lib/viewport-hooks.ts");
  const panel=read("components/pos-ui/pos-payment-panel.tsx");
  expect(controller).toContain('@media (max-height: 650px) and (orientation: landscape)');
  expect(controller).toContain('[data-testid="pos-optical-primary-actions"]');
  expect(controller).toContain("order: 1; gap: 5px");
  expect(controller).toContain('[data-testid="pos-optical-bill-actions"]');
  expect(controller).toContain("order: 2; gap: 5px");
  expect(controller).toContain('[data-testid="pos-optical-pending-actions"]');
  expect(controller).toContain("order: 3; gap: 5px");
  expect(controller).toContain('html[${OPTICAL_ACTIVE_ROOT_ATTRIBUTE}="1"]');
  expect(viewport).toContain("size.width < 768");
  expect(panel).toContain('data-testid="pos-optical-checkout"');
 });
 it("separates deposit entry and payment method, never using onCheckout for a deposit",()=>{
  const panel=read("components/pos-ui/pos-payment-panel.tsx");
  const dialog=read("components/pos/pos-optical-deposit-dialog.tsx");
  expect(panel).toContain("PosOpticalDepositDialog");
  expect(panel).toContain("onOpticalDeposit");
  expect(panel).toContain('data-testid="pos-optical-pending-actions"');
  expect(dialog).toContain('data-testid="optical-deposit-amount"');
  expect(dialog).toContain('setStep("method")');
  expect(dialog).toContain('await onSubmit(amount,"cash",customerId,undefined,dueDate)');
  expect(dialog).toContain('setStep("transfer")');
  expect(dialog).toContain("customerQuery");
  expect(dialog).toContain("disabled={busy}");
  expect(dialog).toContain("onSubmit?T.confirm:T.check");
  expect(dialog).toContain("if(!onSubmit){setError(T.unavailable);return;}");
  expect(dialog).not.toContain("onCheckout");
  expect(dialog).toContain('role="dialog"');
 });
});

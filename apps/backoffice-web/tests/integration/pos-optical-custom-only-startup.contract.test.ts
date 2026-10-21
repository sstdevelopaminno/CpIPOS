import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAuthorizedCustomPosStartupMode } from "../../src/lib/pos-sales-mode-preferences";
import { isAuthorizedOpticalRetailMode, normalizeCustomPosSalesModes } from "../../src/lib/pos-sales-modes";

const read = (file: string) => readFileSync(resolve(process.cwd(),file),"utf8");

describe("CUSTOM IMDC Optical as the only permitted POS sales mode", () => {
 it("starts Optical without unlocking the ordinary takeaway, SD or table modes", () => {
  const grants = normalizeCustomPosSalesModes({
    takeaway:false, dine_in:false, buffet_table:false, delivery:false,
    general_sale:false, optical_retail:true
  });
  expect(getAuthorizedCustomPosStartupMode(["home","dine_in","buffet_table","delivery"],null,grants)).toBe("optical_retail");
  expect(grants.takeaway).toBe(false);
  expect(grants.general_sale).toBe(false);
 });
 it("actually mounts the sales entry gate and its startup controller on the production selling route",()=>{
  const route=read("src/app/preview/pos/page.tsx");
  const gate=read("src/components/pos/pos-entry-gate.tsx");
  expect(route).toContain("<PosEntryGate");
  expect(route).toContain("<PosGeneralSaleTableController lang={lang} />");
  expect(gate).toContain("<PosInitialSalesModeController initialScope={initialScope}");
  expect(gate).toContain("SalesComponent={PosSalesModule}");
  const boundary=read("src/components/pos/pos-dine-in-commit-reset-boundary.tsx");
  expect(boundary).not.toContain("<PosEntryGate");
  expect(boundary).not.toContain("<PosInitialSalesModeController");
  expect(route).toContain("initialScope={{ tenantId: posMenuScope.session.tenant_id, branchId: posMenuScope.session.branch_id }}");
  expect(gate).toContain("if (hasActiveShift && canEnterSales)");
 });
 it("does not require the ordinary Home selector for any granted CUSTOM mode",()=>{
  const boot=read("src/components/pos/pos-initial-sales-mode-controller.tsx");
  expect(boot).not.toContain("MODE_SWITCH_QUERY");
  expect(boot).not.toContain("if (!retailStartup) {");
  expect(boot).not.toContain("POS_STARTUP_MODE_REQUEST_EVENT");
  expect(boot).toContain("<SalesComponent lang={lang} startupMode={authorizedMode} onStartupModeReady={onReady} onStartupModeBlocked={onBlocked} />");
  expect(boot).toContain('readFreshStartupFeatures(() => cancelled)');
 });
 it("acknowledges startup only after React commits the authorized sales mode",()=>{
  const bridge=read("src/components/pos/pos-general-sale-table-controller.tsx");
  const sales=read("src/components/pos/pos-sales-module.tsx");
  expect(sales).toContain('lastAppliedStartupModeRef.current === startupMode');
  expect(sales).toContain('onStartupModeReady?.(startupMode)');
  expect(sales).toContain('data-pos-react-sales-mode=');
  expect(bridge).toContain('reactMode === OPTICAL_MODE_ID && opticalAllowed');
  expect(bridge).toContain("isAuthorizedOpticalRetailMode(body.data)");
 });
 it("permits IT-authorized Optical even if the fixed-package core feature is absent",()=>{
  const snapshot={is_custom:true,sales_modes:{takeaway:false,optical_retail:true},features:{core_pos_sales:false}};
  expect(isAuthorizedOpticalRetailMode(snapshot)).toBe(true);
  expect(isAuthorizedOpticalRetailMode({is_custom:true,sales_modes:{optical_retail:false}})).toBe(false);
  expect(isAuthorizedOpticalRetailMode({is_custom:false,sales_modes:{optical_retail:true}})).toBe(false);
  expect(isAuthorizedOpticalRetailMode({is_custom:true,sales_modes:{}})).toBe(false);
  const boot=read("src/components/pos/pos-initial-sales-mode-controller.tsx");
  const bridge=read("src/components/pos/pos-general-sale-table-controller.tsx");
  expect(boot).toContain("isAuthorizedOpticalRetailMode(payload.data)");
  expect(bridge).toContain("isAuthorizedOpticalRetailMode(body.data)");
  expect(boot).not.toContain("POS-START-HANDSHAKE");
 });
 it("selects standalone CUSTOM modes without granting Home",()=>{
  const allOff={takeaway:false,dine_in:false,buffet_table:false,delivery:false,general_sale:false,optical_retail:false};
  for(const [entitlement,expected] of [
    ["dine_in","dine_in"], ["buffet_table","buffet_table"], ["delivery","delivery"],
    ["general_sale","general_sale"], ["optical_retail","optical_retail"]
  ] as const){
    const modes={...allOff,[entitlement]:true};
    expect(getAuthorizedCustomPosStartupMode(["home","dine_in","buffet_table","delivery"],"STANDARD",modes)).toBe(expected);
    expect(modes.takeaway).toBe(false);
  }
  expect(getAuthorizedCustomPosStartupMode(["home","dine_in","buffet_table","delivery"],"STANDARD",allOff)).toBeNull();
 });
 it("opens authorized SD via a React event, never a hidden Home card click",()=>{
  const bridge=read("src/components/pos/pos-general-sale-table-controller.tsx");
  const sales=read("src/components/pos/pos-sales-module.tsx");
  expect(bridge).toContain("new Event(GENERAL_SALE_ACTIVATE_BASE_MODE_EVENT)");
  expect(bridge).not.toContain("homeButton.click()");
  expect(sales).toContain("window.addEventListener(GENERAL_SALE_ACTIVATE_BASE_MODE_EVENT, onGeneralSaleActivate)");
  expect(sales).toContain('applyQuickMode("home")');
  expect(sales).toContain('if (opticalRetailActive && quickMode === "home") return');
 });
 it("never opens a disabled sales mode when the backend rejects Optical",()=>{
  const bridge=read("src/components/pos/pos-general-sale-table-controller.tsx");
  const startup=read("src/components/pos/pos-initial-sales-mode-controller.tsx");
  expect(bridge).toContain('const allowed = request.mode === OPTICAL_MODE_ID ? opticalAllowed : generalSaleAllowed');
  expect(bridge).toContain('activated: allowed && correctMode');
  expect(startup).toContain('if (customPolicy && !authorizedCustomMode) return fail("POS-START-GRANTS")');
 });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("CUSTOM Recycling uses original POS shell without grocery mode dependency",()=>{
 const main=source("src/app/preview/pos/page.tsx");
 const direct=source("src/app/preview/pos/recycling/page.tsx");
 const general=source("src/app/preview/pos/general/page.tsx");
 const legacy=source("src/components/pos/pos-legacy-sales-content.tsx");
 const recycling=source("src/components/pos/recycling-pos-workspace.tsx");
 const toolbar=source("src/components/pos/recycling-sales-mode-switcher.tsx");
 const server=source("src/lib/server/recycling-general-sale-entitlement.ts");

 it("keeps canonical /preview/pos and does not redirect Recycling users away from it",()=>{
   expect(main).toContain("assertPosMenuPageAllowed");
   expect(main).toContain("requirePosPagePermission");
   expect(main).toContain("await isAuthorizedRecyclingTenant");
   expect(main).toContain("<RecyclingSalesContent");
   expect(main).not.toContain('redirect("/preview/pos/recycling")');
   expect(main).toContain("<PosLegacySalesContent");
   expect(direct).toContain("<RecyclingSalesContent");
 });
 it("reuses all original POS modules without replacing or overlapping their React cashier",()=>{
   expect(legacy).toContain("<PosCustomerDisplayV2Publisher");
   expect(legacy).toContain("<PosGeneralSaleTableController");
   expect(legacy).toContain("<PosEntryGate");
   expect(legacy).toContain("<RecyclingLegacyModeOption");
   expect(toolbar).toContain('document.querySelector(".posui-mode-selector__grid")');
   expect(toolbar).toContain("createPortal");
   expect(toolbar).toContain('data-pos-sale-mode="recycling"');
   expect(toolbar).toContain('className="posui-mode-option"');
 });
 it("restores the old header and mode picker to the single Recycling POS scanner/cart",()=>{
   expect(recycling).toContain("<RecyclingSalesModeSwitcher");
   expect(recycling).toContain('data-testid="recycling-custom-pos"');
   expect(toolbar).toContain('className="posui-mode-switch-button"');
   expect(toolbar).toContain('className="posui-mode-selector-backdrop"');
   expect(toolbar).toContain('data-testid="recycling-original-sales-toolbar"');
   expect(recycling).toContain('id="recycling-barcode"');
   expect(recycling).toContain("openQuantityPopup");
   expect(recycling).toContain("<table");
   expect(recycling).toContain('fetch("/api/pos/recycling/transactions"');
 });
 it("does not silently enable ordinary General Sale for Recycling-only CUSTOM tenants",()=>{
   expect(general).toContain("isAuthorizedCustomGeneralSaleTenant");
   expect(general).toContain("notFound()");
   expect(server).toContain('general_sale !== true');
   expect(server).toContain('pkg.data?.code !== "custom"');
   expect(server).toContain('featureOverride.data?.is_enabled !== true');
   expect(server).toContain("lifecycle.data.access_locked");
   expect(toolbar).toContain("generalSaleEnabled &&");
   expect(toolbar).toContain('href={GENERAL_URL}');
 });
});

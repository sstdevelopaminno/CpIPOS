import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const file=(path:string)=>readFileSync(new URL("../../src/"+path,import.meta.url),"utf8");

describe("CUSTOM branding reset and Lao POS interface contracts",()=>{
 it("shows reset with confirmation and only patches the original shared branding record",()=>{
   const ui=file("components/pos-preview/custom-branding-settings.tsx");
   const server=file("app/api/pos/settings/custom-branding/route.ts");
   expect(ui).toContain("restoreDefaults");
   expect(ui).toContain("window.confirm");
   expect(ui).toContain("persist({...defaults},true)");
   expect(ui).toContain('logo_url:null');
   expect(ui).toContain("cpipos-custom-branding-updated");
   expect(server).toContain("requireCustomBrandingTenant");
   expect(server).toContain('["owner","manager"]');
   expect(server).toContain("cpipos_service_save_custom_branding_v1");
 });
 it("uses Lao rather than defaulting More items and Settings labels to English/Thai",()=>{
   const menu=file("components/pos-preview/pos-more-workspace.tsx");
   const staff=file("components/pos-preview/pos-staff-menu.tsx");
   const settings=file("components/pos-preview/pos-settings-workspace.tsx");
   expect(menu).toContain("moreLao[item.href]");
   expect(staff).toContain('lang === "lo" ? "ຊຳລະຄ່າແພັກເກດ"');
   expect(settings).toContain("settingsLaoLabels");
   expect(settings).toContain('lang === "lo" ? { ...TEXT.en, ...settingsLaoLabels }');
 });
 it("passes server-side selected language to package center and localizes reports",()=>{
   const packagePage=file("app/preview/pos/payments/package/page.tsx");
   const packageUi=file("components/pos-preview/pos-subscription-center.tsx");
   const sales=file("components/pos-preview/pos-sales-summary-dashboard.tsx");
   const product=file("components/pos-preview/product-sales-workspace.tsx");
   expect(packagePage).toContain("getCurrentLanguage");
   expect(packagePage).toContain("lang={lang}");
   expect(packageUi).toContain("ui(tab.label)");
   expect(sales).toContain("loUi(lang");
   expect(product).toContain('lang !== "en"');
   expect(product).toContain("lo-LA");
 });
});
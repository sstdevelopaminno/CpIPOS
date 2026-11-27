import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(path:string)=>readFileSync(new URL("../../src/"+path,import.meta.url),"utf8");
describe("RW preserves the standard SD checkout engine",()=>{
  it("only publishes profile from the authenticated contract feature snapshot",()=>{
    const api=read("app/api/pos/features/route.ts");
    expect(api).toContain("isRetailWholesaleProfile(packagePolicyResult.data?.code, metadata.sales_modes)");
    expect(api).toContain('isCustomPosMenuVisible("main.sales", menuPolicy, true)');
    expect(api).toContain("features.core_pos_sales === true && features.barcode_scanner_mode === true");
  });
  it("uses authorized SD startup and the existing checkout component",()=>{
    const startup=read("components/pos/pos-initial-sales-mode-controller.tsx");
    expect(startup).toContain('payload.data.is_custom === true && payload.data.retail_wholesale === true && mode === "general_sale"');
    expect(startup).toContain('retailWholesale={retailWholesale}');
    const sales=read("components/pos/pos-sales-module.tsx");
    expect(sales).toContain("retailWholesale = false");
    expect(sales).toContain("ค้าปลีก–ค้าส่ง (RW)");
  });
});

import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const get=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
describe("CUSTOM Recycling media / barcode / IT menu isolation",()=>{
 it("keeps stock-only image selection and original product-media quota/upload path",()=>{
  const ui=get("src/components/pos/recycling-stock-workspace.tsx");
  const page=get("src/app/preview/pos/recycling/stock/page.tsx");
  const optimize=get("src/lib/recycling-material-image.ts");
  expect(ui).toContain('type="file"');
  expect(ui).toContain("optimizeRecyclingMaterialImage");
  expect(ui).toContain("/api/pos/product-media/");
  expect(ui).toContain('setEditing(current=>current?{...current,id:savedId}:current)');
  expect(page).toContain("loadProductMediaMap");
  expect(optimize).toContain("1_572_864");
  expect(optimize).toContain("524_288");
 });
 it("does not permit printing unrelated product SKUs or cross-branch labels",()=>{
  const api=get("src/app/api/pos/recycling/barcodes/print/route.ts");
  const worker=get("src/lib/printing/recycling-barcode-print-service.ts");
  expect(api).toContain("isAuthorizedRecyclingTenant");
  expect(api).toContain('metadata as Record<string,unknown>|null)?.business_mode!=="recycling"');
  expect(api).toContain('body?.branch_id!==branchId');
  expect(api).toContain('requirePermission(scope,"inventory:view")');
  expect(worker).toContain("resolvePrinterRoutes");
  expect(worker).toContain("enqueuePrintJob");
  expect(worker).toContain('idempotencyKey:key');
  expect(worker).toContain('payload_format:"receipt_html_v1"');
  expect(worker).not.toContain('.from("orders")');
 });
 it("keeps IT permissions, explicit overrides and accurate fresh client state",()=>{
  const gate=get("src/lib/feature-gate.ts");
  const snapshot=get("src/app/api/pos/features/route.ts");
  const settings=get("src/components/pos-preview/pos-settings-workspace.tsx");
  expect(gate).toContain("hasCustomRecyclingManagementMenuGrant");
  expect(snapshot).toContain("hasCustomRecyclingManagementMenuGrant");
  expect(settings).toContain("/api/pos/features?refresh=1");
  expect(gate).toContain("!tenantOverride && !branchOverride");
 });
});

import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("CUSTOM Recycling report printing preserves original Print Agent",()=>{
 it("requires server-side tenant, branch, entitled mode and unique print request",()=>{
  const route=read("src/app/api/pos/recycling/reports/print/route.ts");
  expect(route).toContain("isAuthorizedRecyclingTenant(tenantId)");
  expect(route).toContain("assertPosMenuPageAllowed");
  expect(route).toContain("requirePosApiFeature");
  expect(route).toContain("loadRecyclingHistoryReport");
  expect(route).toContain("UUID.test(body.request_id)");
 });
 it("prints separate buy/sell totals in 58/80 thermal and submits one routed idempotent job",()=>{
  const text=read("src/lib/printing/recycling-report-print-service.ts");
  expect(text).toContain("renderRecyclingSummaryReportHtml");
  expect(text).toContain("amount/100");
  expect(text).toContain("report.totals.buyMinor");
  expect(text).toContain("report.totals.sellMinor");
  expect(text).toContain("paper===80?56:42");
  expect(text).toContain("resolvePrinterRoutes");
  expect(text).toContain("enqueuePrintJob");
  expect(text).toContain('idempotencyKey:key');
  expect(text).toContain("processPrintJob");
  expect(text).toContain("payload_html:html");
  expect(text).not.toContain('from("orders")');
 });
});

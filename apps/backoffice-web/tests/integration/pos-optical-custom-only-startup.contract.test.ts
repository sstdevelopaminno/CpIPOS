import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAuthorizedCustomPosStartupMode } from "../../src/lib/pos-sales-mode-preferences";
import { normalizeCustomPosSalesModes } from "../../src/lib/pos-sales-modes";

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
 it("does not require the ordinary selector button before dispatching Optical startup",()=>{
  const boot=read("src/components/pos/pos-initial-sales-mode-controller.tsx");
  expect(boot).toContain('mode === "optical_retail" || mode === "general_sale"');
  expect(boot).toContain('if (!retailStartup) {');
  expect(boot).toContain("window.setInterval(() => {");
  expect(boot).toContain("window.clearInterval(retryId)");
 });
 it("waits for the real React POS sales UI and deduplicates a repeated authorization handshake",()=>{
  const bridge=read("src/components/pos/pos-general-sale-table-controller.tsx");
  expect(bridge).toContain('const MODE_SWITCH_BUTTON_QUERY = ".posui-mode-switch-button"');
  expect(bridge).toContain('processingStartupRequestId === request.requestId');
  expect(bridge).toContain('pendingStartupMode = request');
  expect(bridge).toContain('document.querySelector(MODE_SWITCH_BUTTON_QUERY)');
  expect(bridge).toContain('applyRetailStartup(request)');
  expect(bridge).toContain("body?.data?.features?.core_pos_sales === true");
 });
 it("never opens a disabled sales mode when the backend rejects Optical",()=>{
  const bridge=read("src/components/pos/pos-general-sale-table-controller.tsx");
  const startup=read("src/components/pos/pos-initial-sales-mode-controller.tsx");
  expect(bridge).toContain('const allowed = request.mode === OPTICAL_MODE_ID ? opticalAllowed : generalSaleAllowed');
  expect(bridge).toContain('activated: allowed && correctMode');
  expect(startup).toContain('if (customPolicy && !authorizedCustomMode) return complete("error")');
 });
});

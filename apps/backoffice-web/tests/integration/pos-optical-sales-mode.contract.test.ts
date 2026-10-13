import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeCustomPosSalesModes,
  normalizePosSalesModes,
  posUiModeToControlKey
} from "../../src/lib/pos-sales-modes";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IMDC Optical is opt-in and bound to the active POS retail controller", () => {
  it("never enables Optical by default for fixed packages or unset CUSTOM grants", () => {
    expect(normalizePosSalesModes({}).optical_retail).toBe(false);
    expect(normalizeCustomPosSalesModes({}).optical_retail).toBe(false);
    expect(normalizeCustomPosSalesModes({ optical_retail: true }).optical_retail).toBe(true);
    expect(posUiModeToControlKey("optical_retail")).toBe("optical_retail");
  });

  it("uses the production-mounted table controller, not the old unused controller", () => {
    const page = source("src/app/preview/pos/page.tsx");
    const controller = source("src/components/pos/pos-general-sale-table-controller.tsx");
    expect(page).toContain("<PosGeneralSaleTableController />");
    expect(controller).toContain('const OPTICAL_MODE_ID = "optical_retail"');
    expect(controller).toContain("if (!opticalAllowed) return");
    expect(controller).toContain("new Event(OPTICAL_ACTIVATE_BASE_MODE_EVENT)");
    expect(source("src/components/pos/pos-sales-module.tsx")).toContain('applyQuickMode("home")');
    expect(controller).toContain("IMDC OPTICAL");
  });

  it("checks a CUSTOM/IT policy and does not invent a prescription checkout API", () => {
    const controller = source("src/components/pos/pos-general-sale-table-controller.tsx");
    const gate = source("src/components/pos/pos-sales-mode-policy-controller.tsx");
    expect(controller).toContain('body?.data?.sales_modes?.optical_retail === true');
    expect(controller).toContain('body?.data?.features?.core_pos_sales === true');
    expect(gate).toContain('key === "optical_retail" && !isCustom');
  });
});

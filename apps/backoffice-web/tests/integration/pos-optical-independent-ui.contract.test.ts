import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(),path),"utf8");

describe("Optical POS sale identity is separate from internal takeaway order type", () => {
  const pos = read("src/components/pos/pos-sales-module.tsx");
  const controller = read("src/components/pos/pos-general-sale-table-controller.tsx");
  const shared = read("src/lib/pos-general-sale-mode.ts");

  it("activates the eyewear UI while reusing existing secure sales pipeline", () => {
    expect(pos).toContain('const [opticalRetailActive, setOpticalRetailActive] = useState(false)');
    expect(pos).toContain('applyQuickMode("home", true)');
    expect(pos).toContain('setOpticalRetailActive(fromOptical)');
    expect(pos).toContain('pushSubmitMessage(fromOptical ? "IMDC OPTICAL" : text.goHome)');
    expect(pos).toContain('if (opticalRetailActive) return "IMDC OPTICAL"');
    expect(pos).toContain('setOrderType("takeaway")');
  });
  it("renders optical branding instead of the Takeaway mode on the sales UI", () => {
    // The dedicated Optical mode tag remains in the cashier header, but the
    // redundant green in-development banner is intentionally gone.
    expect(pos).not.toContain('data-testid="pos-optical-sale-header"');
    expect(pos).toContain('data-testid="pos-active-optical-mode"');
    expect(pos).toContain("<OpticalRetailModeIcon />");
    expect(pos).toContain('quickMode === "home" && !opticalRetailActive');
    expect(pos).toContain('opticalRetail={opticalRetailActive}');
  });
  it("shows a dedicated right panel without the SD keypad and keeps future money actions disabled", () => {
    const panel = read("src/components/pos-ui/pos-payment-panel.tsx");
    const keypad = read("src/components/pos/pos-general-sale-front-cash-panel.tsx");
    expect(panel).toContain('data-testid="pos-optical-payment-panel"');
    expect(panel).toContain("ชำระเงินมัดจำ");
    expect(panel).toContain("เพิ่มประวัติลูกค้า");
    expect(panel).toContain('aria-disabled="true"');
    expect(panel).toContain("onOpenHeldBills");
    expect(panel).toContain('data-testid="pos-optical-pending-actions"');
    expect(panel).toContain('className={`${buttonClass} col-span-2`}');
    expect(panel).toContain('grid grid-cols-2 gap-3');
    // The global .posui-payment-panel is a block; gap-* alone creates NO spacing.
    // The Optical root must explicitly be grid and have a vertical row gap.
    expect(panel).toContain('display: "grid", gridTemplateColumns: "minmax(0, 1fr)", rowGap: 14, padding: 12');
    expect(panel).toContain('grid min-w-0 grid-cols-2 gap-3 px-1');
    expect(panel).toContain("min-h-[78px] w-full min-w-0");
    expect(panel).toContain('break-words leading-tight');

    expect(panel).not.toContain("Current checkout uses THB · LAK and deposits are unavailable");
    expect(panel).not.toContain("ระบบรับชำระปัจจุบันใช้ THB · เงินกีบและมัดจำยังไม่เปิดใช้งาน");
    expect(panel).not.toContain('aria-hidden="true">\n            IMDC OPTICAL');
    expect(keypad).toContain("isOpticalRetailActive()");
    expect(keypad).toContain("if (active && !isOpticalRetailActive()) renderPanel()");
  });

  it("shows authorized LAK in Optical cashier and rechecks after POS login", () => {
    const panel = read("src/components/pos-ui/pos-payment-panel.tsx");
    const mode = read("src/components/pos/pos-general-sale-mode-controller.tsx");
    expect(panel).toContain('opticalCurrencyCode?: "THB" | "LAK"');
    expect(panel).toContain('opticalCurrencyCode = "THB"');
    expect(panel).toContain('currencyCode === "LAK" ? "₭" : "฿"');
    expect(panel).toContain('data-testid="pos-optical-sales-currency"');
    expect(panel).toContain("formatMoney(total, opticalCurrencyCode)");
    expect(pos).toContain("opticalCurrencyCode={posCurrencyCode}");
    expect(pos).toContain('credentials: "include"');
    expect(pos).toContain('if (!shift?.id) return;');
    expect(pos).toContain('opticalRetailActive && !posCurrencyResolved');
    expect(pos).toContain('data-pos-store-currency');
    expect(pos).toContain('posCurrencyCode === "LAK" ? null :');
    expect(mode).toContain('getAttribute("data-pos-store-currency")');
    expect(mode).toContain('cpipos:store-currency-updated');
    expect(mode).toContain('currency: "THB"');
  });

  it("has compact product barcode scan and a non-financial read-only reservation lookup", () => {
    expect(controller).toContain("OPTICAL_SCAN_IDLE_MS = 140");
    expect(controller).toContain('event.inputType === "insertFromPaste"');
    expect(controller).toContain("opticalFastKeyCount < 5");
    expect(controller).toContain("AbortController()");
    expect(controller).toContain("PRODUCT_LOOKUP_TIMEOUT_MS");
    expect(controller).toContain("ค้นหาบิลมัดจำหรือบิลจอง");
    expect(controller).toContain("ไม่มีการเปลี่ยนแปลงบิลหรือยอดชำระ");
    expect(controller).not.toContain("/api/pos/optical/deposit");
  });

  it("stops showing optical UI after the seller changes modes or IT revokes access", () => {
    expect(shared).toContain('OPTICAL_DEACTIVATE_BASE_MODE_EVENT');
    expect(controller).toContain('if (opticalActive) {');
    expect(controller).toContain('new Event(OPTICAL_DEACTIVATE_BASE_MODE_EVENT)');
    expect(controller).toContain('document.documentElement.removeAttribute(OPTICAL_ACTIVE_ROOT_ATTRIBUTE)');
    expect(pos).toContain('window.addEventListener(OPTICAL_DEACTIVATE_BASE_MODE_EVENT, onOpticalDeactivate)');
    expect(pos).toContain('if (mode === quickMode && !opticalRetailActive)');
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sales = read("src/components/pos/pos-sales-module.tsx");
const retail = read("src/components/pos/pos-general-sale-table-controller.tsx");
const policy = read("src/components/pos/pos-sales-mode-policy-controller.tsx");
const startup = read("src/components/pos/pos-initial-sales-mode-controller.tsx");

describe("POS enabled General Sale/other mode switching", () => {
  it("activates SD from ordinary Home even though both share the home checkout baseline", () => {
    const begin = sales.indexOf("const onGeneralSaleActivate = () => {");
    const end = sales.indexOf("const onOpticalDeactivate =", begin);
    const handler = sales.slice(begin, end);
    expect(begin).toBeGreaterThan(0);
    expect(handler).toContain('setStartupRetailKind("general_sale")');
    expect(handler).toContain("setOpticalRetailActive(false)");
    expect(handler).toContain("setModeSelectorOpen(false)");
    expect(handler).toContain('if (quickMode !== "home")');
    expect(handler).not.toContain('if (!opticalRetailActive && quickMode === "home") return');
    expect(retail).toContain("new Event(GENERAL_SALE_ACTIVATE_BASE_MODE_EVENT)");
    expect(retail).not.toContain("homeButton.click()");
  });

  it("switches directly between SD and Optical without resetting a shared Home cart", () => {
    const begin = sales.indexOf("const onOpticalActivate = () => {");
    const end = sales.indexOf("const onGeneralSaleActivate", begin);
    const handler = sales.slice(begin, end);
    expect(begin).toBeGreaterThan(0);
    expect(handler).toContain('if (quickMode !== "home")');
    expect(handler).toContain("setOpticalRetailActive(true)");
    expect(handler).toContain('setStartupRetailKind("optical_retail")');
    expect(handler).toContain("setModeSelectorOpen(false)");
    expect(retail).toContain("new Event(OPTICAL_ACTIVATE_BASE_MODE_EVENT)");
  });

  it("allows switching from SD or Optical back to ordinary Takeaway", () => {
    const begin = sales.indexOf("function selectQuickMode(mode: QuickMode)");
    const end = sales.indexOf("async function cancelEmptyOpenBill()", begin);
    const switchHandler = sales.slice(begin, end);
    expect(begin).toBeGreaterThan(0);
    expect(switchHandler).toContain('mode === "home" && quickMode === "home"');
    expect(switchHandler).toContain('startupRetailKind === "general_sale"');
    expect(switchHandler).toContain("setOpticalRetailActive(false)");
    expect(switchHandler).toContain("setStartupRetailKind(null)");
    expect(switchHandler).toContain("setModeSelectorOpen(false)");
    expect(switchHandler.indexOf("if (isQuickModeLocked(mode))")).toBeLessThan(switchHandler.indexOf('mode === "home" && quickMode === "home"'));
  });

  it("opens an IT-enabled delivery mode rather than an unconditional maintenance message", () => {
    const begin = sales.indexOf("function selectQuickMode(mode: QuickMode)");
    const end = sales.indexOf("async function cancelEmptyOpenBill()", begin);
    const switchHandler = sales.slice(begin, end);
    expect(switchHandler).toContain("if (isQuickModeLocked(mode))");
    expect(switchHandler).toContain("applyQuickMode(mode)");
    expect(switchHandler).not.toContain('if (mode === "delivery")');
    expect(sales).toContain('setQuickMode("delivery")');
    expect(sales).toContain('setOrderType("delivery_manual")');
    expect(sales).not.toContain("setDeliveryMaintenanceOpen(true)");
  });

  it("refreshes React mode entitlements when IT enables another mode while the POS tab stays open", () => {
    expect(sales).toContain('window.addEventListener("cpipos:pos-feature-policy-updated", onFreshPolicy)');
    expect(sales).toContain('window.removeEventListener("cpipos:pos-feature-policy-updated", onFreshPolicy)');
    expect(sales).toContain("receivedFreshPolicy = true");
    expect(sales).toContain("setEnabledFeatures(snapshot.features)");
    expect(sales).toContain("!receivedFreshPolicy && response.ok");
    expect(retail).toContain('fetch("/api/pos/features?refresh=1"');
    expect(retail).toContain('window.dispatchEvent(new CustomEvent("cpipos:pos-feature-policy-updated"');
  });

  it("keeps server-backed IT grants and does not deactivate SD before a denied mode click", () => {
    expect(policy).toContain('document.addEventListener("click", onClickCapture, true)');
    expect(policy).toContain("event.stopImmediatePropagation()");
    expect(retail).not.toContain('document.addEventListener("click", onModeClick, true)');
    expect(retail).toContain('getAttribute("data-pos-react-sales-mode")');
    expect(retail).toContain("reactMode !== OPTICAL_MODE_ID && reactMode !== GENERAL_SALE_MODE_ID");
    expect(startup).toContain("getAuthorizedCustomPosStartupMode(order ?? [], productProfile, authorizedGrants)");
    expect(sales).toContain('startupRetailKind === "general_sale" && quickMode === "home"');
  });
});

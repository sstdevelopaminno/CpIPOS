import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Optical CUSTOM standalone startup and shift-gate regression", () => {
  it("never bypasses opening a shift before rendering a sale", () => {
    const entry = read("src/components/pos/pos-entry-gate.tsx");
    expect(entry).toContain('session?.has_active_shift && session.shift?.status === "open"');
    expect(entry).toContain("if (hasActiveShift && canEnterSales)");
    expect(entry).toContain('window.location.assign(shiftMenuUrl)');
  });

  it("allows only one open-shift dialog across session handoffs and route transitions", () => {
    const entry = read("src/components/pos/pos-entry-gate.tsx");
    const singleton = read("src/lib/pos-shift-entry-singleton.ts");
    expect(entry).toContain("usePosShiftEntryLeader");
    expect(entry).toContain("if (!shiftEntryLeader) return null");
    expect(entry).toContain('data-pos-open-shift-gate="1"');
    expect(singleton).toContain("useSyncExternalStore");
    expect(singleton).toContain("sharedStore().owners[0] === token.current");
    expect(singleton).toContain("store.owners.splice(index, 1)");
    expect(singleton).toContain("__cpiposShiftEntryStore");
  });

  it("waits for React to register the real Optical activation listener", () => {
    const sales = read("src/components/pos/pos-sales-module.tsx");
    const bridge = read("src/components/pos/pos-general-sale-table-controller.tsx");
    expect(sales).toContain('setAttribute("data-pos-optical-handler-ready", "1")');
    expect(sales).toContain('window.dispatchEvent(new Event("cpipos:optical-handler-ready"))');
    expect(bridge).toContain('document.documentElement.getAttribute(OPTICAL_HANDLER_READY_ATTRIBUTE) === "1"');
    expect(bridge).toContain('window.addEventListener("cpipos:optical-handler-ready", scheduleReconcile)');
    expect(bridge).toContain('window.removeEventListener("cpipos:optical-handler-ready", scheduleReconcile)');
  });

  it("keeps server-authoritative CUSTOM grants and does not authorize disabled sales modes", () => {
    const initial = read("src/components/pos/pos-initial-sales-mode-controller.tsx");
    const bridge = read("src/components/pos/pos-general-sale-table-controller.tsx");
    expect(initial).toContain('/api/pos/features?refresh=1');
    expect(initial).toContain("normalizeCustomPosSalesModes(payload.data.sales_modes)");
    expect(initial).toContain("getAuthorizedCustomPosStartupMode");
    expect(initial).toContain("ACTIVATION_TIMEOUT_MS = 30000");
    expect(bridge).toContain("opticalAllowed = Boolean(response.ok");
    expect(bridge).toContain('body?.data?.sales_modes?.optical_retail === true');
  });
});

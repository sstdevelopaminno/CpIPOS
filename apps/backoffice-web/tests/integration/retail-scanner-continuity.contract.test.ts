import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(p:string)=>readFileSync(new URL("../../src/"+p,import.meta.url),"utf8");
describe("shared SD/RW continuous barcode checkout",()=>{
  const scanner=read("components/pos/pos-general-sale-table-controller.tsx");
  const sidebar=read("components/pos-preview/pos-shell-sidebar.tsx");
  it("consumes Enter even during async lookup and preserves live input",()=>{
    expect(scanner).toContain('event.key === "Enter"');
    expect(scanner).toContain("event.stopPropagation()");
    expect(scanner).toContain("if (code && !event.repeat) void submitScan(code, status, input, submit)");
    expect(scanner).toContain("if (!fromRetailQueue) input.value =");
    expect(scanner).toContain("void submitScan(nextCode.code, scannerStatus, scannerInput, scannerSubmit, nextCode.quantity)");
    expect(scanner).toContain("focusRetailScanner(document, scannerInput)");
  });
  it("retains manual collapse across remount and returns pointer focus",()=>{
    expect(sidebar).toContain("manualCollapseChoice.current ?? mediaQuery.matches");
    expect(sidebar).toContain("window.sessionStorage.setItem(SIDEBAR_COLLAPSED_SESSION_KEY");
    expect(sidebar).toContain("focusRetailScanner(document, undefined, event.currentTarget)");
  });
  it("removes only redundant heading and badge",()=>{
    for(const copy of ["copy.groceryHeading","copy.groceryHint","copy.tableMode"]) expect(scanner).not.toContain(copy);
    expect(scanner).toContain("form.appendChild(quantityLabel)");
    expect(scanner).toContain("copy.groceryPlaceholder");
    expect(scanner).toContain('status.setAttribute("aria-live", "polite")');
    expect(scanner).toContain("ensureTableHost()");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const cashier=src("src/components/pos/recycling-pos-workspace.tsx");
const transactions=src("src/app/api/pos/recycling/transactions/route.ts");
const ordinary=src("src/components/pos/pos-legacy-sales-content.tsx");

describe("Recycling physical keyboard acceptance and cashier safety",()=>{
  it("shows success/error scan dot, and a modal dismissed with Enter without changing POS generic",()=>{
    expect(cashier).toContain('data-testid="recycling-scanner-feedback"');
    expect(cashier).toContain('scanFeedback==="success"');
    expect(cashier).toContain('scanFeedback==="error"');
    expect(cashier).toContain('setScanErrorPopup(message)');
    expect(cashier).toContain('data-testid="recycling-invalid-scan-dialog"');
    expect(cashier).toContain('event.key==="Enter"||event.key==="Escape"');
    expect(cashier).toContain('closeScanErrorPopup()');
    expect(cashier).toContain('resolveRecyclingBarcode(barcodeIndex, normalized)');
    expect(ordinary).not.toContain("recycling-scanner-feedback");
  });
  it("automatically reads the unit from material registry and confirms weight using Enter",()=>{
    expect(cashier).toContain('setUnit(item.priceUnit)');
    expect(cashier).toContain('data-testid="recycling-configured-unit"');
    expect(cashier).not.toContain('เลือกหน่วยจากผลชั่งภายนอก');
    expect(cashier).not.toContain("units.map(value");
    expect(cashier).toContain('if(event.key==="Enter")');
    expect(cashier).toContain('if(!event.repeat)addToCart(event.currentTarget.value)');
    expect(cashier).toContain('calculateRecyclingLine(resolvedQuantity,unit,selectedPrice,pending.priceBasis)');
  });
  it("binds Shift tap, Delete, keypad +/- to safe cashier actions only when no modal",()=>{
    expect(cashier).toContain('onKeyDown={onWorkspaceKeyDown} onKeyUp={onWorkspaceKeyUp}');
    expect(cashier).toContain('event.key==="Shift"');
    expect(cashier).toContain('if(shiftTapArmedRef.current)shiftTapArmedRef.current=false');
    expect(cashier).toContain('!scanBufferRef.current.trim()');
    expect(cashier).toContain('event.key==="Delete"');
    expect(cashier).toContain('event.code==="NumpadSubtract"');
    expect(cashier).toContain('event.code==="NumpadAdd"');
    expect(cashier).toContain('removeLastCartLine()');
    expect(cashier).toContain('parkCurrentBill()');
    expect(cashier).toContain('openCheckout()');
    expect(cashier).toContain('target?.closest("input,textarea,select,[contenteditable=\'true\']")');
    expect(cashier).toContain('!canUseShift || scanErrorPopup || pending||checkoutOpen||heldOpen||cancelOpen');
    expect(cashier).toContain('requestIdRef.current=""');
    expect(ordinary).not.toContain('onWorkspaceKeyDown');
  });
  it("supports left/right and Enter in the cancel popup without immediate irreversible deletion",()=>{
    expect(cashier).toContain('data-testid="recycling-cancel-confirmation"');
    expect(cashier).toContain('event.key==="ArrowLeft"||event.key==="ArrowRight"');
    expect(cashier).toContain('setCancelChoice(event.key==="ArrowLeft"?"keep":"confirm")');
    expect(cashier).toContain('if(cancelChoice==="confirm")cancelCurrentBill()');
    expect(cashier).toContain('else setCancelOpen(false)');
    expect(cashier).toContain('onClick={cancelCurrentBill}');
    expect(cashier).toContain('current.filter(line=>line.direction!==direction)');
  });
  it("selects bank or cash with arrows, Enter uses the existing verified posting gate",()=>{
    expect(cashier).toContain('setSettlement(next)');
    expect(cashier).toContain('event.currentTarget.closest("form")?.requestSubmit()');
    expect(cashier).toContain('if(settlement==="bank_transfer")');
    expect(cashier).toContain('transactionWritesEnabled && visibleLines.length');
    expect(cashier).toContain('if (settlement === "bank_transfer")');
    expect(transactions).toContain('raw.settlement === "bank_transfer"');
    expect(transactions).toContain('recycling_cash_drawer_insufficient');
    expect(cashier).toContain('recycling_cash_drawer_insufficient: "เงินสดในกะไม่เพียงพอ');
    expect(transactions).toContain('recycling_post_transaction');
  });
});

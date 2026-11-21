import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { recyclingCashierShortcutFromCode, RECYCLING_SHORTCUT_DELAY_MS } from "../../src/lib/recycling-cashier-shortcuts";
import { physicalRecyclingBarcodeKey } from "../../src/lib/recycling-scanner-keyboard";
import { buildRecyclingBarcodeIndex, resolveRecyclingBarcode } from "../../src/lib/recycling-barcode-index";
import { calculateRecyclingLine } from "../../src/lib/recycling-calculation";

const src=(file:string)=>readFileSync(resolve(process.cwd(),file),"utf8");
const cashier=src("src/components/pos/recycling-pos-workspace.tsx");
const toolbar=src("src/components/pos/recycling-sales-mode-switcher.tsx");
const transactions=src("src/app/api/pos/recycling/transactions/route.ts");
const ordinary=src("src/components/pos/pos-legacy-sales-content.tsx");

describe("CUSTOM Recycling physical-key cashier shortcuts",()=>{
  it("uses physical W/A/D regardless of Thai or English keyboard layout",()=>{
    expect(recyclingCashierShortcutFromCode("KeyW")).toBe("w");
    expect(recyclingCashierShortcutFromCode("KeyA")).toBe("a");
    expect(recyclingCashierShortcutFromCode("KeyD")).toBe("d");
    expect(recyclingCashierShortcutFromCode("KeyS")).toBeNull();
    expect(physicalRecyclingBarcodeKey("KeyW",false)).toBe("w");
    expect(physicalRecyclingBarcodeKey("KeyA",false)).toBe("a");
    expect(physicalRecyclingBarcodeKey("KeyD",false)).toBe("d");
  });

  it("disambiguates idle W/A/D from the first character of a rapid HID barcode",()=>{
    expect(RECYCLING_SHORTCUT_DELAY_MS).toBeGreaterThanOrEqual(100);
    expect(RECYCLING_SHORTCUT_DELAY_MS).toBeLessThanOrEqual(300);
    expect(cashier).toContain("pendingScannerShortcutRef");
    expect(cashier).toContain("if(pendingScannerShortcutRef.current)flushPendingScannerShortcut()");
    expect(cashier).toContain("updateScannerSearch(scanBufferRef.current+pendingShortcut.letter,true)");
    expect(cashier).toContain("scanBarcode(scanBufferRef.current || event.currentTarget.value)");
    expect(cashier).toContain("document.activeElement===scannerRef.current");
    expect(cashier).toContain("event.nativeEvent.isComposing");
    expect(cashier).toContain("if(editable&&!idleScanner)return");
    const catalog=[{sku:"W123",id:1},{sku:"A456",id:2},{sku:"D789",id:3},{sku:"D789",id:4}];
    const idx=buildRecyclingBarcodeIndex(catalog);
    expect(resolveRecyclingBarcode(idx,"w123")).toEqual({status:"found",item:catalog[0]});
    expect(resolveRecyclingBarcode(idx,"a456")).toEqual({status:"found",item:catalog[1]});
    expect(resolveRecyclingBarcode(idx,"d789")).toEqual({status:"duplicate"});
    expect(resolveRecyclingBarcode(idx,"wrong")).toEqual({status:"missing"});
  });

  it("keeps W for held bills, A buy, D sell, and Escape for all Recycling dialogs",()=>{
    expect(cashier).toContain('if(shortcut==="w")openHeldBills()');
    expect(cashier).toContain('changeDirection(shortcut==="a"?"buy":"sell")');
    expect(cashier).toContain('if(event.key==="Escape")');
    expect(cashier).toContain("if(posting)return; // never dismiss an in-flight payment");
    for(const snippet of ["closeScanErrorPopup()","setCancelOpen(false)","setHeldOpen(false)",
      "setCheckoutOpen(false)","setPending(null)"]){
      expect(cashier).toContain(snippet);
    }
    expect(toolbar).toContain('aria-keyshortcuts="W"');
    expect(toolbar).toContain('aria-keyshortcuts={value==="buy"?"A":"D"}');
    expect(toolbar).toContain('document.addEventListener("keydown",closeOnEscape,true)');
    expect(ordinary).not.toContain("recyclingCashierShortcutFromCode");
  });

  it("preserves unmodified stock/finance writes and refuses unsafe settlement",()=>{
    expect(transactions).toContain('db.rpc("recycling_post_transaction"');
    expect(transactions).toContain('p_request_id: raw.request_id');
    expect(transactions).toContain('recycling_stock_insufficient');
    expect(transactions).toContain('recycling_cash_drawer_insufficient');
    expect(transactions).toContain('raw.settlement === "bank_transfer"');
    expect(transactions).toContain('RECYCLING_TRANSACTION_WRITES_ENABLED');
    expect(cashier).toContain("if (postingRef.current || posting ||");
    expect(cashier).toContain("postingRef.current=true");
    expect(cashier).toContain("requestIdRef.current");
  });

  it("coalesces rapid scanner rendering and computes line totals from satang",()=>{
    expect(cashier).toContain("scanRenderFrameRef");
    expect(cashier).toContain("window.requestAnimationFrame");
    expect(cashier).toContain("updateScannerSearch(replacement,true)");
    expect(cashier).toContain("const sortedProducts=useMemo");
    expect(cashier).toContain("BigInt(Math.round(line.total*100))");
    expect(cashier).toContain("calculateRecyclingLine(nextQuantity,selectedUnit,price,product.priceBasis)");
  });
});

describe("Recycling calculation precision and unit safeguards",()=>{
  it("uses the registered kg-based price across kg, gram, khid and ton",()=>{
    expect(calculateRecyclingLine(1,"kg",35,"kg")).toEqual({amount:35,basisQuantity:1});
    expect(calculateRecyclingLine(5,"khid",35,"kg")).toEqual({amount:17.5,basisQuantity:0.5});
    expect(calculateRecyclingLine(500,"g",35,"kg")).toEqual({amount:17.5,basisQuantity:0.5});
    expect(calculateRecyclingLine(1,"ton",35,"kg")).toEqual({amount:35000,basisQuantity:1000});
  });

  it("rounds half satang up and rejects invalid or mismatched quantities",()=>{
    expect(calculateRecyclingLine(1,"g",5,"kg")).toEqual({amount:0.01,basisQuantity:0.001});
    expect(calculateRecyclingLine(3,"piece",2.15,"piece")).toEqual({amount:6.45,basisQuantity:3});
    expect(calculateRecyclingLine(0.5,"piece",2.15,"piece")).toBeNull();
    expect(calculateRecyclingLine(1,"piece",35,"kg")).toBeNull();
    expect(calculateRecyclingLine(1,"kg",35,"piece")).toBeNull();
    expect(calculateRecyclingLine(-1,"kg",35,"kg")).toBeNull();
    expect(calculateRecyclingLine(0,"kg",35,"kg")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { canRestoreRetailScannerFocus, focusRetailScanner } from "../../src/lib/retail-wholesale/scanner-focus";
const ready = { mode:"general_sale", optical:false, visible:true, modalOpen:false, fieldReady:true, focus:"idle" as const };
describe("SD/RW scanner focus ownership",()=>{
  it.each(["field","idle","trigger"] as const)("restores %s focus",focus=>{
    expect(canRestoreRetailScannerFocus({...ready,focus})).toBe(true);
  });
  it("never steals another field, a payment modal, hidden tab, or other sales mode",()=>{
    expect(canRestoreRetailScannerFocus({...ready,focus:"other"})).toBe(false);
    expect(canRestoreRetailScannerFocus({...ready,modalOpen:true})).toBe(false);
    expect(canRestoreRetailScannerFocus({...ready,visible:false})).toBe(false);
    expect(canRestoreRetailScannerFocus({...ready,fieldReady:false})).toBe(false);
    expect(canRestoreRetailScannerFocus({...ready,optical:true})).toBe(false);
    expect(canRestoreRetailScannerFocus({...ready,mode:"recycling"})).toBe(false);
  });
  it("focuses the field without scrolling and respects other fields and modal",()=>{
    const body={}, root={getAttribute:(name:string)=>name==="data-pos-business-mode"?"general_sale":null};
    let active:unknown=body, modal=false, calls=0;
    const input={isConnected:true,disabled:false,readOnly:false,getClientRects:()=>[{}],focus:(options:FocusOptions)=>{expect(options.preventScroll).toBe(true);calls++;active=input;}};
    const doc={body,documentElement:root,get activeElement(){return active;},visibilityState:"visible",querySelector:()=>input,querySelectorAll:()=>modal?[{getClientRects:()=>[{}]}]:[]} as unknown as Document;
    expect(focusRetailScanner(doc)).toBe(true);
    expect(calls).toBe(1);
    active={}; expect(focusRetailScanner(doc)).toBe(false);
    active=body; modal=true; expect(focusRetailScanner(doc)).toBe(false);
    expect(calls).toBe(1);
  });
});

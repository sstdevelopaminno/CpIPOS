import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),"src/components/pos",p),"utf8");
const button=read("recycling-print-receipt-button.tsx");
const dialog=read("recycling-receipt-dialog.tsx");
const workspace=read("recycling-pos-workspace.tsx");

describe("Recycling receipt print retry boundaries",()=>{
  it("locks synchronously before sending and releases on all outcomes",()=>{
    expect(button).toContain("if (disabled || inFlight.current || pending) return;");
    expect(button.indexOf("inFlight.current=true")).toBeLessThan(button.indexOf("await fetch("));
    expect(button).toMatch(/finally\s*\{\s*inFlight.current=false;/);
  });
  it("reuses a receipt-scoped key across ambiguous outcomes",()=>{
    expect(button).toContain("retry.current?.receiptId===receiptId ? retry.current.requestId");
    expect(button).toContain("retry.current={receiptId,requestId}");
    expect(button).toContain("body:JSON.stringify({request_id:requestId})");
    expect(button.indexOf('jobs.some(job=>job.status==="failed")')).toBeLessThan(button.indexOf("retry.current=null"));
    expect(button).not.toContain("request_id:crypto.randomUUID()");
  });
  it("blocks manual printing during automatic enqueue and reuses its key after failure",()=>{
    expect(dialog).toContain("disabled={printing}");
    expect(dialog).toContain("retryRequestId={autoPrintNotice?.ok===false ? autoPrintRequestId : undefined}");
    expect(workspace).toContain("autoPrintRequestId={posted.printRequestId}");
    expect(workspace).toContain("await queueReceiptPrint(committedId, currentRequestId)");
  });
});

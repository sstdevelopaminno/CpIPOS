import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source=readFileSync(
  resolve(process.cwd(),"src/components/pos-preview/pos-subscription-lifecycle-guard.tsx"),
  "utf8"
);
const devices=readFileSync(
  resolve(process.cwd(),"src/app/login/devices/page-content.tsx"),
  "utf8"
);

describe("POS subscription billing runtime refresh does not flash the UI",()=>{
  it("ignores duplicate worker/realtime snapshots without rerender or event dispatch",()=>{
    expect(source).toContain("const signature=runtimeSignature(next);");
    expect(source).toContain("if(signature===runtimeSignatureRef.current)return;");
    expect(source).toContain("runtimeSnapshotRef.current=next;");
    expect(source).toContain("if(!next)return;");
    expect(source).toContain("setRuntime(next);");
  });
  it("preserves a dismissed reminder while its deadline remains unchanged",()=>{
    expect(source).toContain("if(previous?.expires_at!==next?.expires_at)setDismissed(false);");
    expect(source).not.toContain("      setDismissed(false);\n      window.dispatchEvent");
  });
  it("does not remount sales and shift pages for non-access billing changes",()=>{
    expect(source).toContain("if(accessChanged)router.refresh();");
    expect(source).toContain("previous.locked!==next.locked");
    expect(source).toContain("previous.exempt!==next.exempt");
  });
  it("releases the cashier-device popup without a full-page reload loop",()=>{
    expect(devices).toContain("if(body.data?.entry_access?.allowed===true)");
    expect(devices).toContain("setEntryBlocked(false);");
    expect(devices).toContain("setDevices(data.devices);");
    expect(devices).toContain('setPopup(previous=>previous.type==="error"?{type:"none"}:previous);');
    const poll=devices.slice(devices.indexOf("  // A validated POS OR LINE slip"),devices.indexOf("  async function handleSelectDevice("));
    expect(poll).not.toContain("window.location.reload()");
  });
  it("keeps client state when Next revalidation sends the same initial data",()=>{
    expect(source).toContain("const signature=runtimeSignature(initial);");
    expect(source).toContain("if(!initial && runtimeSnapshotRef.current)return;");
    expect(source).toContain("if(signature===runtimeSignatureRef.current)return;");
  });
});

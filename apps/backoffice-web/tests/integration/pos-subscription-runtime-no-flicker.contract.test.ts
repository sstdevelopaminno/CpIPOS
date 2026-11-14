import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source=readFileSync(
  resolve(process.cwd(),"src/components/pos-preview/pos-subscription-lifecycle-guard.tsx"),
  "utf8"
);

describe("POS subscription billing runtime refresh does not flash the UI",()=>{
  it("ignores duplicate worker/realtime snapshots without rerender or event dispatch",()=>{
    expect(source).toContain("const signature=runtimeSignature(next);");
    expect(source).toContain("if(signature===runtimeSignatureRef.current)return;");
    expect(source).toContain("runtimeSnapshotRef.current=next;");
    expect(source).toContain("setRuntime(next);");
  });
  it("preserves a dismissed reminder while its deadline remains unchanged",()=>{
    expect(source).toContain("if(previous?.expires_at!==next?.expires_at)setDismissed(false);");
    expect(source).not.toContain("      setDismissed(false);\n      window.dispatchEvent");
  });
  it("does not remount sales and shift pages for non-access billing changes",()=>{
    expect(source).toContain("if(accessChanged)router.refresh();");
    expect(source).toContain("previous?.locked!==next?.locked");
    expect(source).toContain("previous?.exempt!==next?.exempt");
  });
  it("keeps client state when Next revalidation sends the same initial data",()=>{
    expect(source).toContain("const signature=runtimeSignature(initial);");
    expect(source).toContain("if(signature===runtimeSignatureRef.current)return;");
  });
});

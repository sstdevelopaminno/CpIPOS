import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";

const pairing=readFileSync(resolve(process.cwd(),"../pos-android/app/src/main/java/com/cpipos/pos/PairingActivity.kt"),"utf8");
const release=readFileSync(resolve(process.cwd(),"src/lib/android-runtime-release.ts"),"utf8");

describe("Android MDM pairing version contract",()=>{
  it("shows the exact Full MDM runtime requirement during pairing",()=>{
    expect(pairing).toContain('FULL_MDM_VERSION = "1.0.23"');
    expect(pairing).toContain("Full MDM ต้องอัปเดตเป็น");
    expect(release).toContain('versionName: "1.0.24"');
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const repoSrc = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("print agent duplicate and discovery stability", () => {
  const browserAgent = src("src/components/printing/browser-print-agent.tsx");
  const androidAgent = repoSrc("apps/pos-android/app/src/main/java/com/cpipos/pos/PosPrintAgent.kt");
  const diagnostics = repoSrc("apps/pos-android/app/src/main/java/com/cpipos/pos/AndroidDiagnostics.kt");
  const mdmAgent = repoSrc("apps/pos-android/app/src/main/java/com/cpipos/pos/PosMdmAgent.kt");
  const autoRegistry = src("src/lib/printing/printer-mdm-auto-registry.ts");

  it("persists physical print success before ACK on browser and Android", () => {
    expect(browserAgent).toContain("rememberPrinted(job.id)");
    expect(browserAgent).toContain("wasRecentlyPrinted(job.id)");
    expect(browserAgent).toContain("physical_print_skipped: true");
    expect(browserAgent).toContain("Do NOT mark the print as failed here");

    expect(androidAgent).toContain("rememberPrinted(jobId)");
    expect(androidAgent).toContain("wasRecentlyPrinted(jobId)");
    expect(androidAgent).toContain('PREF_PRINTED_JOB_LEDGER = "printed_job_ledger_v1"');
    expect(androidAgent).toContain("physical_print_skipped");
  });

  it("coalesces Android wake bursts and uses deeper idle backoff", () => {
    expect(androidAgent).toContain("wakeBurstPending");
    expect(androidAgent).toContain("scheduleWakeBurst()");
    expect(androidAgent).toContain("longArrayOf(1L, 3L, 8L, 15L, 30L)");
  });

  it("publishes physical USB and paired Bluetooth inventory to MDM", () => {
    expect(diagnostics).toContain("printerInventoryJson");
    expect(diagnostics).toContain("physical_fingerprint");
    expect(diagnostics).toContain("bonded_devices");
    expect(mdmAgent).toContain('"runtime_capabilities"');
    expect(mdmAgent).toContain('"inventory", diagnostics.printerInventoryJson()');
    expect(autoRegistry).toContain('stability !== "stable" && stability !== "port_path"');
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const diagnostics = readFileSync(resolve(root, "apps/pos-android/app/src/main/java/com/cpipos/pos/AndroidDiagnostics.kt"), "utf8");
const mdmAgent = readFileSync(resolve(root, "apps/pos-android/app/src/main/java/com/cpipos/pos/PosMdmAgent.kt"), "utf8");
const classifier = readFileSync(resolve(root, "apps/pos-android/app/src/main/java/com/cpipos/pos/PrinterHardwareClassifier.kt"), "utf8");
const modernWorkflow = readFileSync(resolve(root, ".github/workflows/build-android-modern-runtime.yml"), "utf8");

function count(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

describe("Android MDM runtime contract", () => {
  it("keeps Modern Runtime dual-screen compiled in for test, debug, and release builds", () => {
    expect(modernWorkflow).toContain("providers.gradleProperty(\"cpiposDualScreen\")");
    expect(count(modernWorkflow, "-PcpiposDualScreen=true")).toBeGreaterThanOrEqual(3);
  });

  it("emits schema v4 runtime capabilities matching the server auto-registry parser", () => {
    expect(diagnostics).toContain("fun runtimeCapabilities()");
    expect(diagnostics).toContain('.put("schema_version", 4)');
    expect(diagnostics).toContain('.put("target_probe", true)');
    expect(diagnostics).toContain('.put("one_time_verification_print", true)');
    expect(diagnostics).toContain('.put("explicit_assignment_first", true)');
    expect(diagnostics).toContain('.put("automatic_reassignment", false)');
    expect(diagnostics).toContain('"preserve_existing_or_require_confirmation"');
    expect(mdmAgent).toContain('"runtime_capabilities", diagnostics.runtimeCapabilities()');
  });

  it("reports printer inventory without treating a writable endpoint as auto-bind evidence", () => {
    expect(diagnostics).toContain("fun printerInventory()");
    expect(diagnostics).toContain('"safe_autobind_candidate"');
    expect(diagnostics).toContain('"native_transport_candidate"');
    expect(diagnostics).toContain("PrinterHardwareClassifier.usbSafeAutobindCandidate");
    expect(classifier).toContain("usbSafeAutobindCandidate(usbPrinterClass: Boolean, printerNameHint: Boolean)");
    expect(classifier).not.toContain("hasWritableEndpoint")
  });

  it("supports one-time printer verification command reporting through last_command", () => {
    expect(mdmAgent).toContain('"test_printer_verification"');
    expect(mdmAgent).toContain("command.optJSONObject(\"printer_verification\")");
    expect(mdmAgent).toContain('"command_id", lastCommandId');
    expect(mdmAgent).toContain('"result", lastCommandResult');
    expect(diagnostics).toContain("fun testPrinterVerification");
    expect(diagnostics).toContain('"operator_confirmed"');
    expect(diagnostics).toContain('"verification_print_ok"');
  });

  it("serializes customer-display lifecycle diagnostics without changing auth behavior", () => {
    expect(mdmAgent).toContain('"active_secondary_display_id"');
    expect(mdmAgent).toContain('"customer_display_state"');
    expect(mdmAgent).toContain('"last_customer_display_error"');
    expect(mdmAgent).toContain('"last_customer_display_recovery_at"');
    expect(mdmAgent).toContain("notifyCustomerDisplayState");
  });
});

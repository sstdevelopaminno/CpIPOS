import { describe, expect, it } from "vitest";
import { printerMdmAutoRegistryTestables } from "@/lib/printing/printer-mdm-auto-registry";

const { modernPrinterAutoEligible, extractCandidates, inferPaperWidth } = printerMdmAutoRegistryTestables;

function autoSetupPayload() {
  return {
    runtime_capabilities: {
      schema_version: 4,
      updates: { channel: "modern", managed_notice: true, silent_install: false, forced_update: false },
      printer: {
        target_probe: true,
        one_time_verification_print: true,
        explicit_assignment_first: true,
        bluetooth_exact_bonded_verification: true,
        auto_setup: true,
        automatic_reassignment: false,
        assignment_protection: "preserve_existing_or_require_confirmation"
      }
    },
    printer: {
      inventory: {
        usb: {
          devices: [
            {
              vendor_id: 1048,
              product_id: 20497,
              product_name: "GLPrinter80",
              manufacturer_name: "printer",
              serial_number: "18E1D0005C21",
              device_name: "/dev/bus/usb/001/012",
              has_permission: true,
              native_transport_candidate: true,
              safe_autobind_candidate: true,
              physical_fingerprint: "usb:vid0418:pid5011:serial:18e1d0005c21",
              physical_fingerprint_stability: "stable"
            },
            {
              vendor_id: 3034,
              product_id: 33107,
              product_name: "USB 10/100/1000 LAN",
              manufacturer_name: "Realtek",
              has_permission: false,
              native_transport_candidate: true,
              safe_autobind_candidate: false,
              physical_fingerprint: "usb:vid0bda:pid8153:path:dev_bus_usb_002_004",
              physical_fingerprint_stability: "session_scoped"
            }
          ]
        },
        bluetooth: {
          supported: true,
          enabled: true,
          connect_permission_granted: true,
          bonded_devices: [
            {
              name: "GEMAUDIO M200",
              address: "8C:92:AB:16:18:25",
              spp_uuid_present: true,
              printer_name_hint: false,
              physical_fingerprint: "bluetooth:mac:8c92ab161825",
              physical_fingerprint_stability: "stable"
            },
            {
              name: "Inner Printer",
              address: "00:01:02:03:0A:0B",
              spp_uuid_present: false,
              printer_name_hint: true,
              physical_fingerprint: "bluetooth:mac:000102030a0b",
              physical_fingerprint_stability: "stable"
            }
          ]
        }
      }
    }
  };
}

describe("printer MDM auto registry policy", () => {
  it("rejects legacy and pre-auto-setup Modern runtimes", () => {
    expect(modernPrinterAutoEligible({ app: { version_name: "1.0.12" } })).toBe(false);
    const phaseB = autoSetupPayload();
    phaseB.runtime_capabilities.printer.auto_setup = false;
    expect(modernPrinterAutoEligible(phaseB)).toBe(false);
  });

  it("rejects any runtime that permits automatic reassignment", () => {
    const payload = autoSetupPayload();
    payload.runtime_capabilities.printer.automatic_reassignment = true;
    expect(modernPrinterAutoEligible(payload)).toBe(false);
  });

  it("selects only physical printer candidates and supports exact bonded Inner Printer verification", () => {
    const candidates = extractCandidates(autoSetupPayload());
    expect(candidates.map((candidate) => candidate.fingerprint)).toEqual([
      "usb:vid0418:pid5011:serial:18e1d0005c21",
      "bluetooth:mac:000102030a0b"
    ]);
    expect(candidates[0]).toMatchObject({ mode: "usb", status: "online", verificationSupportedNow: true, paperWidthMm: 80 });
    expect(candidates[1]).toMatchObject({ mode: "bluetooth", status: "online", verificationSupportedNow: true });
  });

  it("never treats an SPP-capable audio device as an automatic printer candidate", () => {
    const candidates = extractCandidates(autoSetupPayload());
    expect(candidates.some((candidate) => candidate.fingerprint === "bluetooth:mac:8c92ab161825")).toBe(false);
  });

  it("does not claim Bluetooth exact-bonded verification when capability is not advertised", () => {
    const payload = autoSetupPayload();
    payload.runtime_capabilities.printer.bluetooth_exact_bonded_verification = false;
    const inner = extractCandidates(payload).find((candidate) => candidate.mode === "bluetooth");
    expect(inner).toMatchObject({ verificationSupportedNow: false });
  });

  it("infers 58mm only from explicit 58 evidence", () => {
    expect(inferPaperWidth("XP-58")).toBe(58);
    expect(inferPaperWidth("GLPrinter80")).toBe(80);
    expect(inferPaperWidth("Inner Printer")).toBe(80);
  });
});

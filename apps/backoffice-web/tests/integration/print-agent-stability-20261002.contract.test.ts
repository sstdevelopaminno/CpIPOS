import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const app = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const repo = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("print agent stability 2026-10-02", () => {
  const routed = app("src/lib/printing/routed-print-service.ts");
  const service = app("src/lib/printing/print-service.ts");
  const serial = app("src/components/printing/browser-print-agent.tsx");
  const bluetooth = app("src/components/printing/browser-bluetooth-print-agent.tsx");
  const shared = app("src/components/printing/browser-print-shared.ts");
  const setupGuard = app("src/components/printing/browser-print-agent-serial-setup-guard.tsx");
  const registry = app("src/lib/printing/printer-device-registry.ts");
  const autoRegistry = app("src/lib/printing/printer-mdm-auto-registry.ts");
  const discovery = app("src/app/api/backoffice/printers/discover/route.ts");
  const devicesRoute = app("src/app/api/backoffice/printers/devices/route.ts");
  const manager = app("src/components/backoffice/printer-connection-manager-v3.tsx");
  const androidAgent = repo("apps/pos-android/app/src/main/java/com/cpipos/pos/PosPrintAgent.kt");

  it("deduplicates automatic receipts and payment notices for every tenant scope", () => {
    expect(routed).toContain('idempotencyKey: `receipt:${args.order.id}:payment:${args.paymentMethod}`');
    expect(routed).toContain('idempotencyKey: `payment_notice:${args.order.id}`');
    expect(service).toContain("if (input.idempotencyKey && isUniqueConstraintError(error))");
    expect(service).not.toContain("isRestaurantQrScope");
  });

  it("does not revoke Web Serial permission after transient port contention", () => {
    expect(serial).toContain("SERIAL_MAX_OPEN_FAILURES_BEFORE_RESELECT");
    expect(serial).not.toContain("SERIAL_MAX_OPEN_FAILURES_BEFORE_FORGET");
    expect(setupGuard).toContain('window.localStorage.getItem(DISABLE_DIRECT_WEB_SERIAL_KEY) === "1"');
    expect(setupGuard).not.toContain("forgetAuthorizedPorts");
    expect(setupGuard).not.toContain("dispatchForgetPorts");
  });

  it("suppresses a second physical print after ACK loss", () => {
    expect(shared).toContain("rememberPhysicalPrint");
    expect(shared).toContain("recentlyPhysicallyPrinted");
    expect(serial).toContain("duplicate_suppressed: true");
    expect(bluetooth).toContain("duplicate_suppressed: true");
    expect(androidAgent).toContain("rememberPhysicalSend(jobId");
    expect(androidAgent).toContain("physical_send_recovered");
    expect(androidAgent).toContain("android-recovered:");
  });

  it("coalesces Android wake claims instead of scheduling an unbounded wake storm", () => {
    expect(androidAgent).toContain("wakeClaimScheduled");
    expect(androidAgent).toContain("compareAndSet(false, true)");
    expect(androidAgent).toContain("WAKE_RETRY_DELAY_MS");
    expect(androidAgent).not.toContain("scheduleWakeClaim(0L)");
  });

  it("restores Modern Android USB/Bluetooth discovery and exposes unassigned devices", () => {
    expect(autoRegistry).not.toContain('.from("tenants").select("metadata")');
    expect(autoRegistry).toContain("strict safe-auto-setup contract");
    expect(registry).not.toContain('.not("printer_profile_id", "is", null)');
    expect(registry).toContain("profile_enabled: profile ? profile.enabled !== false : false");
    expect(discovery).toContain('"android_inventory"');
    expect(discovery).toContain("registry.devices");
  });

  it("keeps the selected USB/Bluetooth physical identity across discovery and profile edits", () => {
    expect(discovery).toContain("device_fingerprint: readText(device.device_fingerprint)");
    expect(manager).toContain("setPhysicalFingerprint(item.device_fingerprint ?? null)");
    expect(devicesRoute).toContain("transportIdentityMetadata");
    expect(devicesRoute).toContain("usb_vendor_id");
    expect(devicesRoute).toContain("usb_serial_number");
    expect(devicesRoute).toContain("bluetooth_address");
    expect(devicesRoute).toContain("bodyWithCurrentMetadata");
  });

  it("prevents overlapping browser polling ticks", () => {
    expect(serial).toContain("let tickInFlight = false");
    expect(bluetooth).toContain("let tickInFlight = false");
    expect(serial).toContain("if (tickInFlight)");
    expect(bluetooth).toContain("if (tickInFlight)");
  });
});

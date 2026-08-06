import { describe, expect, it } from "vitest";
import { isDeviceCommandType, isImmediateDeviceCommand } from "@/lib/device-commands";

describe("device command allowlist", () => {
  it("accepts only the fixed allowlist of command types", () => {
    expect(isDeviceCommandType("reload_ui")).toBe(true);
    expect(isDeviceCommandType("disable_device")).toBe(true);
    expect(isDeviceCommandType("rm -rf /")).toBe(false);
    expect(isDeviceCommandType("run_arbitrary_script")).toBe(false);
    expect(isDeviceCommandType(123)).toBe(false);
    expect(isDeviceCommandType(undefined)).toBe(false);
  });

  it("flags only disable/enable device as immediate server-side commands", () => {
    expect(isImmediateDeviceCommand("disable_device")).toBe(true);
    expect(isImmediateDeviceCommand("enable_device")).toBe(true);
    expect(isImmediateDeviceCommand("reload_ui")).toBe(false);
    expect(isImmediateDeviceCommand("clear_print_queue")).toBe(false);
  });
});

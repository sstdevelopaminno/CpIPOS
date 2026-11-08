import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const android = file("../pos-android/app/build.gradle.kts");
const windows = file("../windows-runtime-native/Cpipos.WindowsRuntime/Program.cs");
const bridge = file("../windows-runtime-native/Cpipos.WindowsRuntime/LocalPrintBridge.cs");
const main = file("../windows-runtime-native/Cpipos.WindowsRuntime/MainForm.cs");
const customerWindow = file("../windows-runtime-native/Cpipos.WindowsRuntime/CustomerDisplayWindow.cs");
const androidWorkflow = file("../../.github/workflows/build-android-tablet-1027-dual-screen-qa.yml");
const windowsWorkflow = file("../../.github/workflows/build-windows-webpos-022-dual-screen-qa.yml");

describe("release candidates use the public production POS origin and independent customer display", () => {
  it("uses the same public origin for Android main POS, MDM, print API and second display", () => {
    expect(android).toContain('CPIPOS_API_BASE_URL", "\\"https://pos.cuttingpointinnovation.com\\""');
    expect(android).toContain('CPIPOS_POS_WEB_URL", "\\"https://pos.cuttingpointinnovation.com/login/store\\""');
    expect(android).toContain('CPIPOS_MDM_HEARTBEAT_URL", "\\"https://pos.cuttingpointinnovation.com/api/android-pos/mdm/heartbeat\\""');
    expect(android).toContain('CPIPOS_CUSTOMER_DISPLAY_V2_URL", "\\"https://pos.cuttingpointinnovation.com/customer-display/v2/native\\""');
    expect(android).toContain('CPIPOS_ANDROID_POS_ALLOWED_HOST", "\\"pos.cuttingpointinnovation.com\\""');
    expect(android).not.toContain("cp-ipos-web.vercel.app");
  });
  it("uses public Windows app URL, bootstrap APIs and token-guarded loopback bridge", () => {
    expect(windows).toContain('ProductionAppUrl = "https://pos.cuttingpointinnovation.com/login/store"');
    expect(windows).toContain('https://pos.cuttingpointinnovation.com/api/windows-runtime/v1/bootstrap');
    expect(windows).toContain('string.Equals(uri.Host, "pos.cuttingpointinnovation.com"');
    expect(bridge).toContain('"https://pos.cuttingpointinnovation.com"');
    expect(bridge).toContain('X-CpIPOS-Bridge-Token');
    expect(bridge).not.toContain('"https://cp-ipos-web.vercel.app"');
    expect(main).toContain('native_app_version = "0.2.5"');
  });
  it("keeps two-screen display read-only, optional and separate from cashier controls", () => {
    expect(main).toContain("Screen.AllScreens.FirstOrDefault(screen => !screen.Primary)");
    expect(main).toContain("SyncCustomerDisplayAsync");
    expect(customerWindow).toContain("/customer-display/v2/native");
    expect(customerWindow).toContain("NavigationStarting");
    expect(customerWindow).not.toContain("bridge_token");
    expect(androidWorkflow).toContain('ANDROID_RUNTIME_VERSION_CODE: "36"');
    expect(androidWorkflow).toContain("android-runtime-modern-1.0.27-dual-screen-qa2");
    expect(androidWorkflow).toContain("-PcpiposDualScreen=true");
    expect(windowsWorkflow).toContain("WINDOWS_RUNTIME_VERSION: 0.2.5");
    expect(windowsWorkflow).toContain("windows-webpos-v0.2.5-width-qa1");
  });
});

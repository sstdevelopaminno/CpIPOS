import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const pairRoute = source("../../src/app/api/android-pos/mdm/pair/route.ts");
const selectRoute = source("../../src/app/api/auth/devices/select/route.ts");
const printBootstrap = source("../../src/app/api/android-pos/print-agent/bootstrap/route.ts");
const pairingActivity = source("../../../pos-android/app/src/main/java/com/cpipos/pos/PairingActivity.kt");
const manifest = source("../../../pos-android/app/src/main/AndroidManifest.xml");

describe("Android activation-token enrollment pairing", () => {
  it("consumes a SHA-256 one-time token with replay and expiry guards", () => {
    expect(pairRoute).toContain('createHash("sha256")');
    expect(pairRoute).toContain('.from("activation_tokens")');
    expect(pairRoute).toContain('token.token_type !== "pos_terminal"');
    expect(pairRoute).toContain('token.purpose !== "device_activation"');
    expect(pairRoute).toContain('status: "consumed"');
    expect(pairRoute).toContain('.eq("status", "active")');
    expect(pairRoute).toContain('.is("consumed_at", null)');
    expect(pairRoute).toContain('.gt("expires_at", nowIso)');
    expect(pairRoute).toContain("activation_token_replay_blocked");
  });

  it("creates only a pending untrusted enrollment before IT approval", () => {
    expect(pairRoute).toContain('.from("device_enrollments")');
    expect(pairRoute).toContain('enrollment_status: "pending"');
    expect(pairRoute).toContain('trust_level: "untrusted"');
    expect(pairRoute).toContain("activation_token_id: token.id");
    expect(pairRoute).toContain('pairing_source: "android_activation_token"');
    expect(pairRoute).toContain("android_mdm_install_id: installId");
    expect(pairRoute).toContain('pairing_state: "pending_approval"');
    expect(pairRoute).not.toContain('android_mdm_pair_source: "device_enrollment_approval"');
  });

  it("keeps global physical-install conflict protection and legacy authenticated pairing", () => {
    expect(pairRoute).toContain('.contains("metadata", { android_mdm_install_id: installId })');
    expect(pairRoute).toContain("android_install_id_conflict");
    expect(selectRoute).toContain('android_mdm_pair_source: "authenticated_device_select"');
    expect(selectRoute).toContain("android_install_id_conflict");
  });

  it("lets Print Agent bootstrap only after a branch-device install binding exists", () => {
    expect(printBootstrap).toContain('.contains("metadata", { android_mdm_install_id: installId })');
    expect(printBootstrap).toContain("android_device_not_paired");
    expect(printBootstrap).toContain("android_print_agent_id: agent.id");
  });

  it("keeps the activation token out of deep links and persistent Android storage", () => {
    expect(manifest).toContain('android:scheme="cpipos" android:host="pair"');
    expect(manifest).toContain('android:pathPrefix="/android-pos/pair"');
    expect(manifest).not.toContain("activation_token");
    expect(pairingActivity).toContain('.put("activation_token", token)');
    expect(pairingActivity).not.toContain('putString("activation_token"');
    expect(pairingActivity).toContain('private const val MDM_PREFS = "cpipos_android_pos_mdm"');
    expect(pairingActivity).toContain('private const val INSTALL_ID_KEY = "install_id"');
  });
});

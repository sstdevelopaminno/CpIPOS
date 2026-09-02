import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const activationService = source("../../src/lib/android-pos/commercial-activation.ts");
const confirmRoute = source("../../src/app/api/android-pos/commercial-activation/confirm/route.ts");
const statusRoute = source("../../src/app/api/android-pos/commercial-activation/status/route.ts");
const heartbeatRoute = source("../../src/app/api/android-pos/mdm/heartbeat/route.ts");
const mainActivity = source("../../../pos-android/app/src/main/java/com/cpipos/pos/MainActivity.kt");
const mdmAgent = source("../../../pos-android/app/src/main/java/com/cpipos/pos/PosMdmAgent.kt");
const gate = source("../../../pos-android/app/src/main/java/com/cpipos/pos/CommercialActivationGate.kt");
const manifest = source("../../../pos-android/app/src/main/AndroidManifest.xml");

describe("Android commercial activation gate regression contract", () => {
  it("keeps the server authoritative and effective-date driven", () => {
    expect(activationService).toContain('commercial_activation_effective_date');
    expect(activationService).toContain('timeZone: "Asia/Bangkok"');
    expect(activationService).toContain('metadata.commercial_activation_required === true');
    expect(activationService).toContain('metadata.billing_started === true');
    expect(activationService).toContain('buildPolicyId(contract.id, effectiveDate)');
    expect(activationService).not.toContain('update({ status: "active"');
    expect(activationService).not.toContain('tenant_subscription_payment_requests');
  });

  it("accepts confirmation only from the paired Android installation and does not rewrite contract dates", () => {
    expect(confirmRoute).toContain('request.headers.get("x-cpipos-android-pos") !== "true"');
    expect(confirmRoute).toContain('x-cpipos-install-id');
    expect(confirmRoute).toContain('commercial_activation_policy_mismatch');
    expect(confirmRoute).toContain('export const maxDuration = 10');
    expect(activationService).toContain('.contains("metadata", { android_mdm_install_id: installId })');
    expect(activationService).toContain('commercial_activation_confirmation_source: "android_pos_native_gate"');
    expect(activationService).not.toContain('started_at:');
    expect(activationService).not.toContain('ended_at:');
  });

  it("delivers the gate on the existing low-frequency MDM heartbeat instead of adding polling", () => {
    expect(mdmAgent).toContain('60,\n                TimeUnit.SECONDS');
    expect(mdmAgent).toContain('commercial_activation_capabilities');
    expect(mdmAgent).toContain('.put("native_gate", true)');
    expect(heartbeatRoute).toContain('commercialActivationEligible(payload)');
    expect(heartbeatRoute).toContain('resolveCommercialActivationGate(scope)');
    expect(heartbeatRoute).toContain('activation_gate: activationGate');
  });

  it("refreshes the policy once at normal boot so a customer need not open POS first", () => {
    expect(statusRoute).toContain('resolveCommercialActivationGateForInstall');
    expect(statusRoute).toContain('request.headers.get("x-cpipos-android-pos") !== "true"');
    expect(statusRoute).toContain('x-cpipos-install-id');
    expect(statusRoute).toContain('export const maxDuration = 10');
    expect(gate).toContain('/api/android-pos/commercial-activation/status');
    expect(gate).toContain('refreshFromServerAfterBoot(context)');
    expect(gate).toContain('goAsync()');
    expect(gate).toContain('createDeviceProtectedStorageContext()');
  });

  it("keeps the POS app blocked locally across restart/offline periods until server confirmation succeeds", () => {
    expect(gate).toContain('.putBoolean(KEY_REQUIRED, true)');
    expect(gate).toContain('.setCancelable(false)');
    expect(gate).toContain('.setCanceledOnTouchOutside(false)');
    expect(gate).toContain('.setOngoing(true)');
    expect(mainActivity).toContain('commercialActivationGate?.showIfRequired()');
    expect(mainActivity).toContain('if (commercialActivationGate?.isBlocking() == true)');
    expect(manifest).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('.CommercialActivationBootReceiver');
    expect(manifest).toContain('android:exported="false"');
  });

  it("uses whole-device LockTask only on Device Owner installations and never factory-resets the terminal", () => {
    expect(gate).toContain('manager.isDeviceOwnerApp(activity.packageName)');
    expect(gate).toContain('manager.setLockTaskPackages');
    expect(gate).toContain('activity.startLockTask()');
    expect(mdmAgent).toContain('.put("non_device_owner_whole_device_lock", false)');
    expect(gate).not.toContain('factoryReset');
    expect(gate).not.toContain('wipeData');
    expect(mdmAgent).not.toContain('factory_reset');
  });
});

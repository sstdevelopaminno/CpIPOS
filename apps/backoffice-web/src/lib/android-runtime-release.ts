export const ANDROID_UPDATE_SIGNING_CERT_SHA256 = "6be0a9aef346a5b47162c8928c5018a01d0e7d81b4eb177bf2fb89922dc2a27a";

export const ANDROID_STABLE_RELEASE = {
  versionName: "1.0.12",
  versionCode: 18,
  channel: "stable",
  releaseTag: "android-runtime-latest",
  assetName: "CpIPOS-Android-POS-1.0.12.apk",
  downloadPath: "/download/android/latest"
} as const;

export const ANDROID_MODERN_RELEASE = {
  versionName: "1.0.20",
  versionCode: 27,
  channel: "modern",
  releaseTag: "android-runtime-modern-1.0.20",
  assetName: "CpIPOS-Android-POS-1.0.20.apk",
  compatibilityAssetName: "CpIPOS-Android-POS-Modern.apk",
  manifestAssetName: "CpIPOS-Android-POS-1.0.20.manifest.json",
  downloadPath: "/download/android/modern-latest",
  downloadUrl: "https://cp-ipos-web.vercel.app/download/android/modern-latest",
  manifestPath: "/download/android/modern-latest/manifest",
  manifestUrl: "https://cp-ipos-web.vercel.app/download/android/modern-latest/manifest",
  signingCertSha256: ANDROID_UPDATE_SIGNING_CERT_SHA256
} as const;

const PROTECTED_LEGACY_TENANT_CODES = new Set(["FG0003", "FG00003"]);

type UpdateOfferInput = {
  tenantCode: string | null;
  payload: Record<string, unknown> | null;
  deviceStatus?: string | null;
  deviceLocked?: boolean | null;
};

export type AndroidModernUpdateOffer = {
  channel: "modern";
  version_name: string;
  version_code: number;
  download_url: string;
  manifest_url: string;
  signing_cert_sha256: string;
  install_policy: "notice_only" | "staged";
  silent_when_device_owner: true;
  mandatory: false;
  latest: true;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function supportsVerifiedStagedUpdater(updates: Record<string, unknown>) {
  return updates.staged_updater === true &&
    updates.interactive_install === true &&
    updates.package_installer === true &&
    updates.sha256_verification === true &&
    updates.signing_certificate_verification === true;
}

export function buildAndroidModernUpdateOffer(input: UpdateOfferInput): AndroidModernUpdateOffer | null {
  const tenantCode = String(input.tenantCode ?? "").trim().toUpperCase();
  const payload = input.payload ?? {};
  const runtimeCapabilities = asRecord(payload.runtime_capabilities);
  const updates = asRecord(runtimeCapabilities.updates);
  const app = asRecord(payload.app);

  // Opt-in only. Legacy APKs do not emit this exact capability contract, so they are
  // structurally ineligible even when their numeric version is lower than the latest release.
  if (String(updates.channel ?? "").trim().toLowerCase() !== ANDROID_MODERN_RELEASE.channel) return null;
  if (updates.managed_notice !== true) return null;
  if (updates.silent_install !== false) return null;
  if (updates.forced_update !== false) return null;

  const currentVersionCode = Number(app.version_code);
  if (!Number.isFinite(currentVersionCode) || currentVersionCode <= 0) return null;
  if (currentVersionCode >= ANDROID_MODERN_RELEASE.versionCode) return null;

  const protectedLegacyTenant = Boolean(tenantCode) && PROTECTED_LEGACY_TENANT_CODES.has(tenantCode);
  const verifiedStagedUpdater = supportsVerifiedStagedUpdater(updates);
  const maintenanceLocked = String(input.deviceStatus ?? "").trim().toLowerCase() === "maintenance" && input.deviceLocked === true;

  // FG0003 remains fail-closed unless the installed runtime itself proves it has the
  // verified updater contract and the device is explicitly maintenance-locked.
  if (protectedLegacyTenant && !(verifiedStagedUpdater && maintenanceLocked)) return null;

  return {
    channel: ANDROID_MODERN_RELEASE.channel,
    version_name: ANDROID_MODERN_RELEASE.versionName,
    version_code: ANDROID_MODERN_RELEASE.versionCode,
    download_url: ANDROID_MODERN_RELEASE.downloadUrl,
    manifest_url: ANDROID_MODERN_RELEASE.manifestUrl,
    signing_cert_sha256: ANDROID_MODERN_RELEASE.signingCertSha256,
    install_policy: protectedLegacyTenant ? "staged" : "notice_only",
    silent_when_device_owner: true,
    mandatory: false,
    latest: true
  };
}

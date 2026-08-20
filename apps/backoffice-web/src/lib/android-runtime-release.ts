export const ANDROID_STABLE_RELEASE = {
  versionName: "1.0.12",
  versionCode: 18,
  channel: "stable",
  releaseTag: "android-runtime-latest",
  assetName: "CpIPOS-Android-POS-1.0.12.apk",
  downloadPath: "/download/android/latest"
} as const;

export const ANDROID_MODERN_RELEASE = {
  versionName: "1.0.17",
  versionCode: 23,
  channel: "modern",
  releaseTag: "android-runtime-modern-1.0.17",
  assetName: "CpIPOS-Android-POS-1.0.17.apk",
  compatibilityAssetName: "CpIPOS-Android-POS-Modern.apk",
  downloadPath: "/download/android/modern-latest",
  downloadUrl: "https://cp-ipos-web.vercel.app/download/android/modern-latest"
} as const;

const PROTECTED_LEGACY_TENANT_CODES = new Set(["FG0003", "FG00003"]);

type UpdateOfferInput = {
  tenantCode: string | null;
  payload: Record<string, unknown> | null;
};

export type AndroidModernUpdateOffer = {
  channel: "modern";
  version_name: string;
  version_code: number;
  download_url: string;
  mandatory: false;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function buildAndroidModernUpdateOffer(input: UpdateOfferInput): AndroidModernUpdateOffer | null {
  const tenantCode = String(input.tenantCode ?? "").trim().toUpperCase();
  if (tenantCode && PROTECTED_LEGACY_TENANT_CODES.has(tenantCode)) return null;

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

  return {
    channel: ANDROID_MODERN_RELEASE.channel,
    version_name: ANDROID_MODERN_RELEASE.versionName,
    version_code: ANDROID_MODERN_RELEASE.versionCode,
    download_url: ANDROID_MODERN_RELEASE.downloadUrl,
    mandatory: false
  };
}

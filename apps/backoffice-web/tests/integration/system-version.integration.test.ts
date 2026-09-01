import { describe, expect, it } from "vitest";

describe("system version endpoint", () => {
  it("reports Android POS from the Modern release source of truth", async () => {
    const { GET } = await import("@/app/api/system/version/route");
    const { ANDROID_MODERN_RELEASE } = await import("@/lib/android-runtime-release");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.source_versions.android_pos).toBe(ANDROID_MODERN_RELEASE.versionName);
    expect(body.data.source_versions.android_pos).toBe("1.0.23");
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(
  process.cwd(),
  "src/app/download/mobile/latest/route.ts",
);

describe("Native Mobile stable download route", () => {
  it("uses the supported Native stable release channel and excludes prereleases", () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("releases?per_page=30");
    expect(source).toContain("stableNativeTagPattern");
    expect(source).toContain("!item.draft");
    expect(source).toContain("!item.prerelease");
    expect(source).toContain('item.name.startsWith("CpIPOS-Native-Mobile-")');
    expect(source).toContain('item.name.endsWith(".apk")');
    expect(source).not.toContain("cpipos-mobile-latest");
    expect(source).not.toContain('const assetName = "CpIPOS-Mobile.apk"');
  });
});

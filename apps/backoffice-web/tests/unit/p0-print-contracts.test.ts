import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(...segments: string[]) {
  return readFileSync(resolve(process.cwd(), ...segments), "utf8");
}

describe("P0 print contracts", () => {
  it("requires assignment profiles to match the requested printer role", () => {
    const source = readRepoFile("src", "lib", "printing", "printer-routing-service.ts");

    expect(source).toContain('.eq("printer_role", args.legacyRole)');
    expect(source).toContain('.eq("enabled", true)');
  });

  it("keeps Android heartbeat separate and bounds idle claim polling", () => {
    const source = readRepoFile(
      "..",
      "pos-android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "cpipos",
      "pos",
      "PosPrintAgent.kt"
    );

    expect(source).toContain("private const val HEARTBEAT_INTERVAL_SECONDS = 45L");
    expect(source).toContain("private val IDLE_BACKOFF_SECONDS = longArrayOf(2L, 5L, 10L, 15L)");
    expect(source).toContain('.put("claim_poll_policy", "adaptive_2_5_10_15s")');
  });
});

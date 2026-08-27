import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(...segments: string[]) {
  return readFileSync(resolve(process.cwd(), ...segments), "utf8");
}

describe("P0 production contracts", () => {
  it("requires assignment profiles to match the requested printer role", () => {
    const source = readRepoFile("src", "lib", "printing", "printer-routing-service.ts");

    expect(source).toContain('.eq("printer_role", args.legacyRole)');
    expect(source).toContain('.eq("enabled", true)');
  });

  it("keeps Android heartbeat separate and idle polling bounded at the approved 1-3-8 policy", () => {
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
    expect(source).toContain("private val IDLE_BACKOFF_SECONDS = longArrayOf(1L, 3L, 8L)");
    expect(source).toContain('.put("claim_poll_policy", "adaptive_1_3_8s")');
    expect(source).toContain("fun notifyPrintQueued()");
    expect(source).toContain("WAKE_RETRY_DELAY_MS = 350L");
  });

  it("uses sku without probing the removed products.code column", () => {
    const source = readRepoFile("src", "app", "api", "pos", "sales", "route.ts");

    expect(source).toContain('selectClause: "id,sku,name,category,price,is_active,stock_deduction_mode"');
    expect(source).not.toMatch(/selectClause:\s*"[^"]*\bcode\b/);
    expect(source).not.toContain("row.code");
    expect(source).not.toContain("preferredCode");
  });

  it("does not query the non-existent tenants.metadata column", () => {
    const sessionGuard = readRepoFile("src", "lib", "pos-session-guard.ts");
    const productProfile = readRepoFile("src", "app", "api", "pos", "product-profile", "route.ts");

    expect(sessionGuard).toContain('.from("tenants").select("id,name,code,is_active")');
    expect(sessionGuard).not.toContain('select("id,name,code,is_active,metadata")');
    expect(productProfile).toContain('.from("tenants")');
    expect(productProfile).toContain('.select("code")');
    expect(productProfile).not.toContain('.select("code,metadata")');
  });
});

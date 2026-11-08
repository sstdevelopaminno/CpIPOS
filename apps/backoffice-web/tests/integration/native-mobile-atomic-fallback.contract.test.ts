import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(new URL(
  "../../src/lib/services/pos-sales-service.ts", import.meta.url
), "utf8");

describe("Native mobile server-authoritative atomic order fallback guard", () => {
  it("never creates a Native sale by non-atomic direct insertion", () => {
    expect(service).toContain("const nativeAtomicRequired = input.native_mobile === true ||");
    expect(service).toContain("item.native_selection != null");
    expect(service).toContain('code: "native_atomic_rpc_required"');
    expect(service).toContain("nativeAtomicRequired && shouldPreferDirectCreatePath");
    expect(service).toContain("if (nativeAtomicRequired) {");
    expect(service).toContain('parsed.code === "rpc_not_available"');
    expect(service).toContain("!nativeAtomicRequired && parsed.code === \"insufficient_stock\"");
  });
});

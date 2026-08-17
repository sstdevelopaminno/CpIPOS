import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("dine-in cart merge regression contract", () => {
  it("uses the first server snapshot as the committed baseline when local baseline is not initialized", () => {
    const sourcePath = fileURLToPath(new URL("../../src/components/pos/pos-sales-module.tsx", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const baselineItems = committedBaseline.length > 0 ? committedBaseline : serverItems;");
    expect(source).toContain("for (const item of baselineItems)");
    expect(source).not.toContain("for (const item of committedBaseline) {\n      const key = buildCartMergeKey(item);");
  });
});

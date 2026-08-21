import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/pos/monitor/route.ts"), "utf8");

describe("POS monitor error classification regression", () => {
  it("keeps monitor:view required for the monitoring reader", () => {
    expect(source).toContain('requiredPermission: "monitor:view"');
  });

  it("returns forbidden instead of server error for permission denial", () => {
    expect(source).toContain('normalizedMessage.includes("permission denied")');
    expect(source).toContain('normalizedMessage.includes("monitor:view")');
    expect(source).toContain('permissionDenied ? 403');
    expect(source).toContain('permissionDenied ? "forbidden"');
  });
});

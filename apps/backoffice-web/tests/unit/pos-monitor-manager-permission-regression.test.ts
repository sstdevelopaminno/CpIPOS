import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const authModule = readFileSync(resolve(process.cwd(), "src/lib/pos-api-auth.ts"), "utf8");
const monitorRoute = readFileSync(resolve(process.cwd(), "src/app/api/pos/monitor/route.ts"), "utf8");
const perfRoute = readFileSync(resolve(process.cwd(), "src/app/api/pos/perf/route.ts"), "utf8");

describe("POS monitor manager permission regression", () => {
  it("allows only manager monitor:view as the narrow implicit POS API permission", () => {
    expect(authModule).toContain('permission === "monitor:view" && role === "manager"');
    expect(authModule).toContain("if (hasImplicitPosApiPermission(scope, permission))");
    expect(authModule).toContain("requirePermission(scope, permission);");
  });

  it("keeps monitoring endpoints behind monitor:view", () => {
    expect(monitorRoute).toContain('requiredPermission: "monitor:view"');
    expect(perfRoute.match(/requiredPermission: "monitor:view"/g)?.length).toBe(2);
  });
});

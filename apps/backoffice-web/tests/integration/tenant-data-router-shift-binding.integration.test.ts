import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(new URL("../../src/lib/tenant-data-router.ts", import.meta.url), "utf8");

describe("Tenant data router runtime lease shift binding", () => {
  it("requires the cookie POS session to belong to the selected open shift", () => {
    expect(routerSource).toContain("cookieSession.shift_id === args.shiftId");
  });

  it("filters fallback active POS-session lookup by the selected open shift", () => {
    expect(routerSource).toContain('.eq("shift_id", args.shiftId)');
  });
});

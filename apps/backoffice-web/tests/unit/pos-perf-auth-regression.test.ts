import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/pos/perf/route.ts"), "utf8");

describe("POS performance telemetry authorization regression", () => {
  it("keeps monitor:view on the GET monitoring reader", () => {
    const getStart = source.indexOf("export async function GET");
    const postStart = source.indexOf("export async function POST");
    const getSection = source.slice(getStart, postStart);
    expect(getSection).toContain('requiredPermission: "monitor:view"');
    expect(getSection).toContain("Only manager, owner, accountant, or IT Admin");
  });

  it("allows authenticated branch-scoped POS roles to emit telemetry without monitor:view", () => {
    const postStart = source.indexOf("export async function POST");
    const postSection = source.slice(postStart);
    expect(postSection).toContain("getPosApiAuthContext({ requireBranchScope: true })");
    expect(postSection).not.toContain('requiredPermission: "monitor:view"');
  });
});

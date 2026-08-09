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
  it("routes kitchen enqueue RPCs through the data-home router", () => {
    expect(routerSource).toContain('"enqueue_kitchen_order"');
    expect(routerSource).toContain("BUSINESS_RPCS.has(fn) ? deferredRpc(fn, params, options) : target.rpc(fn, params, options)");
  });

  it("registers Trial kitchen tickets and print jobs but not kitchen zones from enqueue results", () => {
    expect(routerSource).toContain('if (fn === "enqueue_kitchen_order")');
    expect(routerSource).toContain('add("kitchen_tickets", asString(row.kitchen_ticket_id))');
    expect(routerSource).toContain('add("print_jobs", asString(row.print_job_id))');
    expect(routerSource).not.toContain('add("kitchen_zones", asString(row.zone_id))');
  });
});

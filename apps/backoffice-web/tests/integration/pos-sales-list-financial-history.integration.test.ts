import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(resolve(process.cwd(), "src/app/api/pos/sales-list/route.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/lib/services/pos-sales-list-service.ts"), "utf8");

function sectionBetween(startMarker: string, endMarker?: string) {
  const start = route.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = endMarker ? route.indexOf(endMarker, start + startMarker.length) : route.length;
  expect(end).toBeGreaterThan(start);
  return route.slice(start, end);
}

describe("POS sales-list financial history contract", () => {
  it("hides a sales-list row by metadata without cancelling the authoritative order", () => {
    const deleteSection = sectionBetween("export async function DELETE(request: Request)");

    expect(deleteSection).toContain("sales_list_deleted: true");
    expect(deleteSection).toContain("sales_record_financial_state_preserved: true");
    expect(deleteSection).toContain("hidden_only: true");
    expect(deleteSection).not.toContain('status: "cancelled"');
    expect(deleteSection).not.toContain("cancelled_reason");
    expect(service).toContain("sales_list_deleted !== true");
  });

  it("keeps Sales List from becoming a second payment or void engine", () => {
    const patchSection = sectionBetween(
      "export async function PATCH(request: Request)",
      "export async function DELETE(request: Request)"
    );

    expect(patchSection).toContain("sales_record_financial_state_immutable");
    expect(patchSection).toContain("financial_state_preserved: true");
    expect(patchSection).toContain(".update({ notes, metadata: nextMetadata })");
    expect(route).not.toContain('.from("payments").delete()');
    expect(route).not.toContain('.from("payments").insert(');
  });
});

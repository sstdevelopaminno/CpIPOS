import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/components/pos/pos-users-module.tsx"), "utf8");

describe("POS users actions visibility contract", () => {
  it("keeps edit and delete controls visible while preserving permission disables", () => {
    expect(source).toContain("sticky right-0 bg-slate-100");
    expect(source).toContain("sticky right-0 bg-white");
    expect(source).toContain("disabled={!item.can_edit}");
    expect(source).toContain("disabled={saving || !canDelete || !item.can_delete}");
    expect(source).toContain('<div className="overflow-x-auto"><table');
    expect(source).toContain('className="flex min-w-[128px] justify-end gap-2"');
    expect(source).toContain("rounded-md border px-3 py-2 text-xs font-bold");
    expect(source).toContain("editUnavailable");
    expect(source).toContain("deleteUnavailable");
    expect(source).not.toContain("{item.can_edit ? <button");
    expect(source).not.toContain("{canDelete && item.can_delete ? <button");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("table number editing and stock action visibility", () => {
  it("keeps new table numbering automatic but allows editing an existing table number", () => {
    const page = source("src/components/tables/table-management-page.tsx");

    expect(page).toContain("text.autoTableCode(nextAutoTableCode)");
    expect(page).toContain("disabled aria-label={text.tableCode}");
    expect(page).toContain("table_code: tableCode");
    expect(page).toContain("onChange={(event) => setTableForm((current) => ({ ...current, table_code: event.target.value }))}");
    expect(page).toContain("ระบบกำหนดเลขรันอัตโนมัติเมื่อเพิ่มโต๊ะ และแก้หมายเลขโต๊ะได้ภายหลัง");
  });

  it("updates table_code server-side only within the selected branch and rejects duplicates", () => {
    const route = source("src/app/api/backoffice/tables/[tableId]/route.ts");

    expect(route).toContain('if (body.table_code !== undefined)');
    expect(route).toContain('.eq("branch_id", targetBranchId)');
    expect(route).toContain('.eq("table_code", tableCode)');
    expect(route).toContain('.neq("id", tableId)');
    expect(route).toContain('updatePayload.table_code = tableCode');
    expect(route).toContain('fail("table_code_conflict"');
  });

  it("keeps stock action controls pinned on the right on narrower screens", () => {
    const table = source("src/components/pos-preview/stock-products-table.tsx");

    expect(table).toContain('className="min-w-[1080px] w-full border-collapse"');
    expect(table).toContain("sticky right-0 z-20 min-w-[132px]");
    expect(table).toContain("sticky right-0 z-10 min-w-[132px]");
    expect(table).toContain("flex flex-nowrap items-center gap-1.5");
  });
});

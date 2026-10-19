import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const view=readFileSync(resolve(process.cwd(),"src/components/pos/optical-stock-workspace.tsx"),"utf8");
const db=readFileSync(resolve(process.cwd(),"src/app/preview/pos/stock/custom/page.tsx"),"utf8");
const locale=readFileSync(resolve(process.cwd(),"src/lib/optical-stock-i18n.ts"),"utf8");
describe("CUSTOM Optical inventory presentation",()=>{
it("uses wrapped and spaced branch and action controls",()=>{
expect(view).toContain("gap-x-4 gap-y-3 lg:w-auto");
expect(view).toContain("flex min-w-[180px] flex-col gap-1");
});
it("never calls missing stock zero",()=>{
expect(view).toContain('remaining(row)??"—"');
expect(view).toContain("ยังไม่บันทึกจำนวนรับเข้าสต๊อก ไม่ใช่ยอดคงเหลือ 0");
expect(db).toContain("optical_stock_bins");
expect(locale).toContain("Stock receipt not recorded (not zero inventory)");
});
it("takes scanner keyboard input into SKU without adjusting quantity",()=>{
expect(view).toContain('autoComplete="off" spellCheck={false}');
expect(view).toContain('if(e.key==="Enter")e.preventDefault()');
expect(view).toContain("กรอกหรือสแกนบาร์โค้ดได้");
});
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const view=readFileSync(resolve(process.cwd(),"src/components/pos/optical-stock-workspace.tsx"),"utf8");
const db=readFileSync(resolve(process.cwd(),"src/app/preview/pos/stock/custom/page.tsx"),"utf8");
const locale=readFileSync(resolve(process.cwd(),"src/lib/optical-stock-i18n.ts"),"utf8");
describe("CUSTOM Optical inventory presentation",()=>{
it("aligns the responsive action group with the back button instead of wrapping below it",()=>{
expect(view).toContain('data-testid="optical-inventory-toolbar"');
expect(view).toContain("lg:grid-cols-[auto_minmax(0,1fr)]");
expect(view).toContain('data-testid="optical-inventory-actions"');
expect(view).toContain("flex w-full min-w-0 flex-wrap items-center justify-start gap-3 lg:justify-end");
expect(view).toContain("flex min-w-0 items-center gap-2");
expect(view).toContain('aria-label={T("เลือกสาขาสต๊อก")}');
});
it("removes only the redundant optical inventory heading, preserving all action buttons",()=>{
expect(view).not.toContain('>CUSTOM · OPTICAL INVENTORY</p>');
expect(view).not.toContain('<h1 className="mt-1 text-2xl font-extrabold text-slate-900">');
expect(view).not.toContain(' · ข้อมูลแยกตาม Tenant และ Branch</p>');
for(const action of ['show("summary")','show("scan")','show("best")','show("add")','show("bulk")']){
  expect(view).toContain(action);
}
expect(view).toContain('<PosBackButton lang={lang} href="/preview/pos/more"');
expect(view).toContain('data-testid="custom-optical-inventory"');
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

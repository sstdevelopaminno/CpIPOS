import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
describe("Recycling cashier navigation label",()=>{
 it("renames only the Recycling-enabled POS sales entry without changing its route or fallback",()=>{
  const source=readFileSync(resolve(process.cwd(),"src/components/pos-preview/pos-staff-menu.tsx"),"utf8");
  expect(source).toContain('item.key === "pos_menu_sales" && recyclingMenuAllowed');
  expect(source).toContain('lang === "th" ? "แคชเชียร์"');
  expect(source).toContain('item.key === "pos_menu_sales_list" && recyclingMenuAllowed');
  expect(source).toContain(': labelFor(item, lang)');
  expect(source).toContain('key: "pos_menu_sales", href: "/preview/pos"');
 });
});

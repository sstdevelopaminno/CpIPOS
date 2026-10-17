import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {generalSaleUi} from "../../src/lib/pos-general-sale-i18n";

const source=readFileSync(new URL("../../src/components/pos/pos-general-sale-table-controller.tsx",import.meta.url),"utf8");

describe("CUSTOM Optical cart: adapt to usable width, no hidden columns",()=>{
 it("switches based on actual cart container width rather than global tablet width",()=>{
  expect(source).toContain("container-type: inline-size;");
  expect(source).toContain("container-name: optical-cart;");
  expect(source).toContain("@container optical-cart (max-width: 820px)");
  expect(source).toContain("@container optical-cart (max-width: 365px)");
  expect(source).toContain('html[${OPTICAL_ACTIVE_ROOT_ATTRIBUTE}="1"] .cpipos-sd-table');
  expect(source).toContain("box-sizing: border-box; table-layout: auto;");
 });
 it("preserves five fields, prices and delete as visible two-row item cards",()=>{
  expect(source).toContain('grid-template-areas: "name name name remove" "qty unit total total";');
  expect(source).toContain('"name name remove"');
  expect(source).toContain('"unit total total"');
  expect(source).toContain("grid-area: name;");
  expect(source).toContain("grid-area: qty;");
  expect(source).toContain("grid-area: unit;");
  expect(source).toContain("grid-area: total;");
  expect(source).toContain("grid-area: remove;");
  expect(source).toContain("white-space: normal; overflow: visible;");
  expect(source).toContain("content: attr(data-optical-money-label)");
  expect(source).toContain('unitPriceCell.dataset.opticalMoneyLabel = copy.headers[5]');
  expect(source).toContain('totalCell.dataset.opticalMoneyLabel = copy.headers[6]');
  expect(source).toContain('unitPriceCell.setAttribute("aria-label"');
  expect(source).toContain('totalCell.setAttribute("aria-label"');
 });
 it("retains existing controls, accounting values and all non-Optical table columns",()=>{
  expect(source).toContain('qty.append(decrease, qtyValue, increase)');
  expect(source).toContain('decrease.dataset.sdAction = "decrease"');
  expect(source).toContain('increase.dataset.sdAction = "increase"');
  expect(source).toContain('remove.dataset.sdAction = "delete"');
  expect(source).toContain('unitPriceCell.textContent = formatMoney(row.unitPrice)');
  expect(source).toContain('totalCell.textContent = formatMoney(row.lineTotal)');
  expect(source).toContain('if (opticalActive) tr.append(nameCell, qtyCell, unitPriceCell, totalCell, actionCell)');
  expect(source).toContain('else tr.append(indexCell, skuCell, categoryCell, nameCell, qtyCell, unitPriceCell, totalCell, actionCell)');
  expect(source).toContain('const headers = opticalActive ? copy.headers.slice(3) : copy.headers');
  expect(generalSaleUi.th.headers).toHaveLength(8);
  expect(generalSaleUi.lo.headers).toHaveLength(8);
  expect(generalSaleUi.en.headers).toHaveLength(8);
  for(const language of ["th","lo","en"] as const){
   expect(generalSaleUi[language].headers[5]).toBeTruthy();
   expect(generalSaleUi[language].headers[6]).toBeTruthy();
  }
 });
});

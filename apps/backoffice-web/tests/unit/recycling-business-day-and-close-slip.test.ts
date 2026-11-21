import {describe,expect,it} from "vitest";
import {recyclingBusinessDayKey,recyclingShiftIsToday} from "@/lib/recycling-business-day";
import {renderRecyclingDailyShiftCloseHtml,recyclingDailyShiftCloseText} from "@/lib/printing/recycling-daily-shift-close-slip";

describe("CUSTOM Recycling Thailand daily shift cutoff",()=>{
 it("changes exactly at midnight Bangkok even on a foreign cashier device",()=>{
  expect(recyclingBusinessDayKey(new Date("2026-11-20T16:59:59.999Z"))).toBe("2026-11-20");
  expect(recyclingBusinessDayKey(new Date("2026-11-20T17:00:00Z"))).toBe("2026-11-21");
  expect(recyclingShiftIsToday("2026-11-20T16:59:59.999Z",new Date("2026-11-20T17:00:00Z"))).toBe(false);
  expect(recyclingShiftIsToday("2026-11-20T17:00:00Z",new Date("2026-11-20T17:00:01Z"))).toBe(true);
 });
 it("does not accept invalid dates as an active business day",()=>{
  expect(recyclingBusinessDayKey(new Date(NaN))).toBe("");
  expect(recyclingShiftIsToday("",new Date("2026-11-21T00:00:00Z"))).toBe(false);
 });
});
describe("Recycling official close slip",()=>{
 const shift={
  id:"11111111-1111-4111-8111-111111111111",
  branchName:'A&B <branch>',
  openedAt:"2026-11-20T03:00:00Z",
  closedAt:"2026-11-20T17:00:04Z",
  openingCash:null,expectedCash:null,actualCash:null,
  metadata:{
   business_shift_mode:"recycling_daily",
   close_reason:"recycling_daily_auto_close_midnight",
   system_auto_closed:true,
   cash_count_required:true,
   recycling_buy_count:2,recycling_sell_count:1,
   recycling_cash_in_minor:80000,recycling_cash_out_minor:22000,
   recycling_cash_net_minor:58000,recycling_transfer_in_minor:10000,
   recycling_transfer_out_minor:0,recycling_expected_cash_minor:null
  } as Record<string,unknown>
 };
 it("always preserves purchase payouts as negative cash movement, not negative sales",()=>{
  const txt=recyclingDailyShiftCloseText(shift);
  expect(txt).toContain("รับซื้อ 2 บิล");
  expect(txt).toContain("ขายออก 1 บิล");
  expect(txt).toContain("เงินสดรับ 800.00");
  expect(txt).toContain("เงินสดจ่าย 220.00");
  expect(txt).toContain("เงินสดคาดการณ์ รอตรวจสอบ");
  expect(txt).toContain("เงินตรวจนับจริง รอตรวจนับ");
  expect(txt).not.toContain("Actual cash 0.00");
 });
 it("builds thermal 58/80mm non-tax slip using source-only values",()=>{
  for(const paper of [58,80] as const){
   const html=renderRecyclingDailyShiftCloseHtml(shift,paper);
   expect(html).toContain("@page{size:"+paper+"mm auto");
   expect(html).toContain("สรุปปิดกะ");
   expect(html).toContain("รอตรวจนับ");
   expect(html).toContain("ไม่ใช่ใบเสร็จหรือใบกำกับภาษี");
   expect(html).toContain("A&amp;B &lt;branch&gt;");
   expect(html).not.toContain("A&B <branch>");
  }
 });
});

import {describe,it,expect} from "vitest";
import {startRecyclingDocumentClock,recyclingDocumentClockAt} from "../../src/lib/recycling-document-time";
describe("Recycling document-only running clock",()=>{
 const now=new Date("2026-11-27T03:00:00Z");
 it("advances from selected document time without modifying actual time",()=>{
  const clock=startRecyclingDocumentClock("2026-11-25T09:30:00","บันทึกรายการจริงย้อนหลัง",now);
  expect(clock).not.toBeNull();
  expect(recyclingDocumentClockAt(clock!,new Date("2026-11-27T03:02:03Z"))).toBe("2026-11-25T09:32:03");
  expect(now.toISOString()).toBe("2026-11-27T03:00:00.000Z");
 });
 it("rejects future dates, invalid dates, excessive age and insufficient reason",()=>{
  for(const value of ["2026-11-28T09:00:00","2026-02-30T09:00:00","2024-01-01T09:00:00"])expect(startRecyclingDocumentClock(value,"Verified historical transaction",now)).toBeNull();
  expect(startRecyclingDocumentClock("2026-11-25T09:30:00","x",now)).toBeNull();
 });
});

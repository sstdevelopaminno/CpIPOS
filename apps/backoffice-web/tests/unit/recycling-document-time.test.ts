import {describe,it,expect} from "vitest";
import {bangkokLocalDateTime,parseRecyclingDocumentTime} from "../../src/lib/recycling-document-time";
describe("Recycling manual document time",()=>{
 const now=new Date("2026-11-26T14:20:00.000Z");
 it("uses Bangkok time and preserves seconds",()=>{
  expect(bangkokLocalDateTime(now)).toBe("2026-11-26T21:20:00");
  expect(parseRecyclingDocumentTime("2026-11-25T08:09:10",now)).toBe("2026-11-25T01:09:10.000Z");
  expect(parseRecyclingDocumentTime("2026-11-25T08:09",now)).toBe("2026-11-25T01:09:00.000Z");
 });
 it("rejects future, impossible calendar and explicit timezone inputs",()=>{
  for(const value of ["2026-11-26T21:20:01","2026-02-30T08:00","2026-11-25T24:00","2026-11-25T08:00Z","",null,123]){
   expect(parseRecyclingDocumentTime(value,now)).toBeNull();
  }
 });
});

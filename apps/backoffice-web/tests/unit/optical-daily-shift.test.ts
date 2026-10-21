import {describe,expect,it} from "vitest";
import {
  nextOpticalMidnightUtc,startOfOpticalLocalDateUtc,resolveOpticalDailyShift,resolveOpticalTimeZone,
  sumVerifiedOpticalDeposits,type OpticalLedgerPayment
} from "@/lib/pos-optical-daily-shift";

describe("Optical CUSTOM daily shift is country-aware and isolated",()=>{
  it("uses one shift until midnight for Thailand and Laos, not three food slots",()=>{
    expect(resolveOpticalDailyShift({country:"TH",openedAt:"2026-10-15T07:15:00Z"})?.cutoffAt.toISOString())
      .toBe("2026-10-15T17:00:00.000Z");
    const lao=resolveOpticalDailyShift({country:"LA",openedAt:"2026-10-15T13:15:00Z"});
    expect(lao?.cutoffAt.toISOString()).toBe("2026-10-15T17:00:00.000Z");
    expect(lao?.autoCloseAt.toISOString()).toBe("2026-10-15T17:00:00.000Z");
  });
  it("requires an explicit US timezone and calculates DST changes safely",()=>{
    expect(resolveOpticalTimeZone("US")).toBeNull();
    expect(resolveOpticalDailyShift({country:"US",openedAt:"2026-11-01T04:30:00Z"})).toBeNull();
    // New York falls back from EDT to EST on Nov 1: civil day has 25 hours.
    expect(nextOpticalMidnightUtc(new Date("2026-11-01T04:30:00Z"),"America/New_York")?.toISOString())
      .toBe("2026-11-02T05:00:00.000Z");
    expect(resolveOpticalDailyShift({
      country:"US",openedAt:"2026-11-01T04:30:00Z",approvedTimeZone:"America/New_York"
    })?.currency).toBe("USD");
  });
  it("derives exact local date filtering even when the US DST clock changes",()=>{
    expect(startOfOpticalLocalDateUtc("2026-11-01","America/New_York")?.toISOString())
      .toBe("2026-11-01T04:00:00.000Z");
    expect(startOfOpticalLocalDateUtc("2026-11-02","America/New_York")?.toISOString())
      .toBe("2026-11-02T05:00:00.000Z");
    expect(startOfOpticalLocalDateUtc("2026-10-15","Asia/Bangkok")?.toISOString())
      .toBe("2026-10-14T17:00:00.000Z");
    expect(startOfOpticalLocalDateUtc("2026-02-30","Asia/Bangkok")).toBeNull();
  });
  it("does not include full settlement or unverified transfers in deposit revenue",()=>{
    const base={shift_id:"shift-1",branch_id:"branch-1",work_order_id:"job-1",
      currency_code:"LAK",received_at:"2026-10-15T12:00:00Z",verified_by:null};
    const received:OpticalLedgerPayment[]=[
      {...base,request_id:"initial",method:"cash",amount:500,cumulative_paid:500},
      {...base,request_id:"final",method:"cash",amount:500,cumulative_paid:1000},
      {...base,request_id:"unverified",method:"bank_transfer",amount:50,cumulative_paid:550},
      {...base,request_id:"wrong-branch",branch_id:"branch-2",method:"cash",amount:50,cumulative_paid:600},
      {...base,request_id:"initial",method:"cash",amount:500,cumulative_paid:500}
    ];
    expect(sumVerifiedOpticalDeposits({
      shiftId:"shift-1",branchId:"branch-1",currency:"LAK",received,
      orders:[{id:"job-1",branch_id:"branch-1",currency_code:"LAK",total_amount:1000}],
      openedAt:new Date("2026-10-15T10:00:00Z"),cutoffAt:new Date("2026-10-15T17:00:00Z")
    })).toEqual({deposit_total:500,deposit_cash:500,deposit_transfer:0,deposit_count:1});
  });
});

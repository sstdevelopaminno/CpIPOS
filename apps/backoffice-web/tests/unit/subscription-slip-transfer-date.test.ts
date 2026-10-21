import {describe,it,expect} from "vitest";
import {validateSubscriptionTransferDate} from "@/lib/payments/subscription-slip-ai";
const now=Date.parse("2026-10-20T15:00:00Z");
describe("subscription evidence transfer date gate",()=>{
 it("accepts a recent ISO bank transfer time with an explicit timezone",()=>{
  expect(validateSubscriptionTransferDate("2026-10-20T14:00:00Z",now)).toBe(true);
  expect(validateSubscriptionTransferDate("2026-10-20T20:30:00+07:00",now)).toBe(true);
 });
 it("supports Thai Buddhist year dates at Bangkok local time",()=>{
  expect(validateSubscriptionTransferDate("20/10/2569 20:30",now)).toBe(true);
  expect(validateSubscriptionTransferDate("20/10/2026 20:30",now)).toBe(true);
 });
 it("rejects stale, forged-future, malformed and nonexistent slip transfer dates",()=>{
  expect(validateSubscriptionTransferDate("2026-10-01T14:00:00Z",now)).toBe(false);
  expect(validateSubscriptionTransferDate("2026-10-20T16:00:00Z",now)).toBe(false);
  expect(validateSubscriptionTransferDate("31/02/2569 19:00",now)).toBe(false);
  expect(validateSubscriptionTransferDate("20/10/2569",now)).toBe(false);
  expect(validateSubscriptionTransferDate("today",now)).toBe(false);
  expect(validateSubscriptionTransferDate(null,now)).toBe(false);
 });
});

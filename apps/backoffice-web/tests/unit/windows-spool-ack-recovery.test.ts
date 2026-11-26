import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmWindowsSpoolAck } from "../../src/lib/printing/windows-spool-ack-recovery";

afterEach(()=>vi.useRealTimers());
describe("confirmed Windows spool ACK recovery",()=>{
 it("retries only the exact acknowledged attempt once on transient transport failure",async()=>{
  vi.useFakeTimers();
  const attempt={job_id:"job-1",agent_attempt_id:"attempt-1",provider_job_id:"spool-1"};
  const send=vi.fn<(payload:typeof attempt)=>Promise<{status:string}>>()
   .mockRejectedValueOnce(new TypeError("network disconnected"))
   .mockResolvedValueOnce({status:"printed"});
  const result=confirmWindowsSpoolAck(()=>send(attempt),new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toEqual({status:"printed"});
  expect(send.mock.calls).toEqual([[attempt],[attempt]]);
 });
 it("does not retry a stale/denied attempt",async()=>{
  const send=vi.fn().mockRejectedValue(new Error("PRINT_JOB_ATTEMPT_STALE"));
  await expect(confirmWindowsSpoolAck(send,new AbortController().signal)).rejects.toThrow("PRINT_JOB_ATTEMPT_STALE");
  expect(send).toHaveBeenCalledTimes(1);
 });
 it("stops after one retry, never creating a retry loop",async()=>{
  vi.useFakeTimers();
  const send=vi.fn().mockRejectedValue(new Error("windows_agent_unavailable"));
  const result=confirmWindowsSpoolAck(send,new AbortController().signal);
  const failed=expect(result).rejects.toThrow("windows_agent_unavailable");
  await vi.advanceTimersByTimeAsync(1000);
  await failed;
  expect(send).toHaveBeenCalledTimes(2);
 });
 it("cancels a delayed retry on component shutdown",async()=>{
  vi.useFakeTimers();
  const controller=new AbortController();
  const send=vi.fn().mockRejectedValue(new TypeError("disconnected"));
  const result=confirmWindowsSpoolAck(send,controller.signal);
  const failed=expect(result).rejects.toMatchObject({name:"AbortError"});
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await failed;
  expect(send).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
 });
});

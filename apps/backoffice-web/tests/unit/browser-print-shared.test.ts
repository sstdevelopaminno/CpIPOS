import { describe, expect, it } from "vitest";
import { agentAttemptIdForJob, type BrowserPrintJob } from "@/components/printing/browser-print-shared";

describe("browser print claim attempt propagation", () => {
  it("uses the server-issued attempt id from the claimed job", () => {
    const job: BrowserPrintJob = { id: "job-1", agent_attempt_id: "attempt-1" };

    expect(agentAttemptIdForJob(job)).toBe("attempt-1");
  });

  it("uses the new attempt id after a job is re-claimed", () => {
    const firstClaim: BrowserPrintJob = { id: "job-1", agent_attempt_id: "attempt-old" };
    const secondClaim: BrowserPrintJob = { id: "job-1", agent_attempt_id: "attempt-new" };

    expect(agentAttemptIdForJob(firstClaim)).toBe("attempt-old");
    expect(agentAttemptIdForJob(secondClaim)).toBe("attempt-new");
  });

  it("keeps attempt ids per claimed job", () => {
    const jobs: BrowserPrintJob[] = [
      { id: "job-1", agent_attempt_id: "attempt-1" },
      { id: "job-2", agent_attempt_id: "attempt-2" }
    ];

    expect(jobs.map(agentAttemptIdForJob)).toEqual(["attempt-1", "attempt-2"]);
  });

  it("does not substitute a missing attempt id", () => {
    const job = { id: "job-1" } as BrowserPrintJob;

    expect(() => agentAttemptIdForJob(job)).toThrow("print_attempt_id_missing_from_claim");
  });
});
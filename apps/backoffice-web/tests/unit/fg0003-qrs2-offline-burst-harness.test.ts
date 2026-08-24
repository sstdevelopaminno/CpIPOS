import { describe, expect, it } from "vitest";

type ReviewStatus = "pending_pos_review" | "kitchen_confirming" | "accepted" | "rejected";

type Submission = {
  id: string;
  requestId: string;
  fingerprint: string;
  status: ReviewStatus;
  orderId: string | null;
};

function printKey(submissionId: string, copy: number) {
  return [
    `kitchen:${submissionId}`,
    "printer:printer-1",
    "device:device-1",
    "purpose:kitchen",
    "zone:hot",
    `copy:${copy}`
  ].join(":");
}

async function simulateBurst(level: number) {
  const byFingerprint = new Map<string, Submission>();
  const submissions = new Map<string, Submission>();
  const printKeys = new Set<string>();
  let duplicateSubmits = 0;
  let duplicatePrints = 0;
  let accepted = 0;

  function submit(requestId: string, fingerprint: string) {
    const existing = byFingerprint.get(fingerprint);
    if (existing) {
      duplicateSubmits += 1;
      return existing;
    }
    const submission: Submission = {
      id: `submission-${submissions.size + 1}`,
      requestId,
      fingerprint,
      status: "pending_pos_review",
      orderId: null
    };
    byFingerprint.set(fingerprint, submission);
    submissions.set(submission.id, submission);
    return submission;
  }

  async function accept(submissionId: string) {
    await Promise.resolve();
    const submission = submissions.get(submissionId);
    if (!submission) throw new Error("missing_submission");
    if (submission.status !== "pending_pos_review") return { alreadyReviewed: true };
    submission.status = "kitchen_confirming";
    await Promise.resolve();
    submission.orderId = `order-${submission.id}`;
    submission.status = "accepted";
    accepted += 1;
    for (const copy of [1, 2]) {
      const key = printKey(submission.id, copy);
      if (printKeys.has(key)) duplicatePrints += 1;
      printKeys.add(key);
    }
    return { alreadyReviewed: false };
  }

  async function reject(submissionId: string) {
    await Promise.resolve();
    const submission = submissions.get(submissionId);
    if (!submission) throw new Error("missing_submission");
    if (submission.status !== "pending_pos_review") return { alreadyReviewed: true };
    submission.status = "rejected";
    return { alreadyReviewed: false };
  }

  for (let i = 0; i < level; i += 1) {
    submit(`request-${i}`, `table-a:item-${i}:qty-1`);
  }
  for (let i = 0; i < Math.min(level, 5); i += 1) {
    submit(`request-${i}-retry`, `table-a:item-${i}:qty-1`);
  }

  await Promise.all(
    Array.from(submissions.values()).flatMap((submission) => [accept(submission.id), accept(submission.id)])
  );

  const contested = submit(`reject-race-${level}`, `table-b:race-${level}`);
  const raceResults = await Promise.all([accept(contested.id), reject(contested.id), accept(contested.id)]);
  const winners = raceResults.filter((result) => !result.alreadyReviewed).length;

  return {
    level,
    duplicateSubmits,
    duplicatePrints,
    accepted,
    printJobs: printKeys.size,
    winners,
    terminalCount: Array.from(submissions.values()).filter((submission) => submission.status === "accepted" || submission.status === "rejected").length
  };
}

describe("Restaurant QR offline burst harness", () => {
  it.each([5, 10, 25, 50])("keeps duplicate submits/reviews from creating duplicate print jobs at level %i", async (level) => {
    const result = await simulateBurst(level);
    expect(result.level).toBe(level);
    expect(result.duplicateSubmits).toBe(Math.min(level, 5));
    expect(result.duplicatePrints).toBe(0);
    expect(result.winners).toBe(1);
    expect(result.accepted).toBe(level + 1);
    expect(result.printJobs).toBe((level + 1) * 2);
    expect(result.terminalCount).toBe(level + 1);
  });
});

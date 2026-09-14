import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const agent = readFileSync(resolve(root, "apps/pos-android/app/src/main/java/com/cpipos/pos/PosPrintAgent.kt"), "utf8");

describe("Android print queue wake contract", () => {
  it("clears stale pre-login bootstrap cooldown when an authenticated POS action queues print work", () => {
    const wakeStart = agent.indexOf("fun notifyPrintQueued()");
    expect(wakeStart).toBeGreaterThanOrEqual(0);
    const wakeBody = agent.slice(wakeStart, wakeStart + 500);
    expect(wakeBody).toContain("bootstrapRetryAfterElapsedMs = 0L");
    expect(wakeBody).toContain("idleBackoffIndex = 0");
    expect(wakeBody).toContain("scheduleWakeClaim(0L)");
    expect(wakeBody).toContain("scheduleWakeClaim(WAKE_RETRY_DELAY_MS)");
  });
});

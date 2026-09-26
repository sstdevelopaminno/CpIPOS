import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/pos/pos-maintenance-notice.tsx"),
  "utf8"
);

describe("POS maintenance and emergency broadcast contract", () => {
  it("coalesces broadcast refreshes and keeps the alert user-dismissible", () => {
    expect(source).toContain("broadcastRequestRef");
    expect(source).toContain("if (broadcastRequestRef.current) return broadcastRequestRef.current");
    expect(source).toContain("BROADCAST_REFRESH_MS = 120 * 1000");
    expect(source).toContain('document.visibilityState === "hidden"');
    expect(source).toContain("dismissedBroadcastKey");
    expect(source).toContain("setBroadcastDismissed(true)");
    expect(source).toContain('aria-label="ปิดข้อความแจ้งเตือน"');
  });

  it("preserves the local 23:00-04:00 maintenance fallback", () => {
    expect(source).toContain("hour >= 23 || (hour >= 0 && hour < 4)");
    expect(source).toContain("REPEAT_INTERVAL_MS = 60 * 60 * 1000");
    expect(source).toContain("AUTO_HIDE_MS = 15 * 1000");
    expect(source).toContain("แจ้งปรับปรุงระบบชั่วคราว เวลา 23:00–04:00 น.");
  });
});

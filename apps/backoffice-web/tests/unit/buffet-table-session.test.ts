import { describe, expect, it } from "vitest";
import {
  formatBuffetTableSessionLabel,
  mergeBuffetTableSessionSummaryMetadata,
  normalizeBuffetTableSessionSummary
} from "../../src/lib/buffet-table-session";

describe("buffet table session summary", () => {
  it("normalizes active per-person and set quantities", () => {
    const summary = normalizeBuffetTableSessionSummary({
      keep_me: true,
      buffet_session: {
        enabled: true,
        per_person_quantity: 2,
        set_quantity: 1,
        total_quantity: 99,
        subtotal: 997,
        updated_at: "2026-08-21T00:00:00.000Z"
      }
    });

    expect(summary).toEqual({
      enabled: true,
      per_person_quantity: 2,
      set_quantity: 1,
      total_quantity: 3,
      subtotal: 997,
      updated_at: "2026-08-21T00:00:00.000Z"
    });
  });

  it("keeps non-buffet metadata while replacing the buffet summary", () => {
    const metadata = mergeBuffetTableSessionSummaryMetadata(
      { keep_me: "yes", buffet_session: { enabled: false } },
      {
        enabled: true,
        per_person_quantity: 3,
        set_quantity: 0,
        total_quantity: 3,
        subtotal: 597,
        updated_at: "2026-08-21T01:00:00.000Z"
      }
    );

    expect(metadata.keep_me).toBe("yes");
    expect(metadata.buffet_session).toEqual({
      enabled: true,
      per_person_quantity: 3,
      set_quantity: 0,
      total_quantity: 3,
      subtotal: 597,
      updated_at: "2026-08-21T01:00:00.000Z"
    });
  });

  it("formats a compact table label without inventing missing quantities", () => {
    const summary = normalizeBuffetTableSessionSummary({
      buffet_session: { enabled: true, per_person_quantity: 2, set_quantity: 1, subtotal: 997 }
    });
    expect(formatBuffetTableSessionLabel(summary, "th")).toBe("บุฟเฟ่ 2 ท่าน · 1 ชุด");
    expect(formatBuffetTableSessionLabel(summary, "en")).toBe("Buffet 2 guests · 1 set");
  });

  it("does not mark an empty summary as active", () => {
    const summary = normalizeBuffetTableSessionSummary({
      buffet_session: { enabled: true, per_person_quantity: 0, set_quantity: 0, subtotal: 0 }
    });
    expect(summary.enabled).toBe(false);
    expect(summary.total_quantity).toBe(0);
  });
});

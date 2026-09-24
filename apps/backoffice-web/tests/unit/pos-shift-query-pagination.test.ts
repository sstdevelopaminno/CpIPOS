import { describe, expect, it } from "vitest";
import { collectPagedShiftRows, collectShiftRowsForIds } from "@/lib/pos-shift-query-pagination";

describe("financial shift data pagination", () => {
  it("returns all 1,205 rows despite the default Supabase 1,000-row result cap", async () => {
    const rows = Array.from({ length: 1205 }, (_, id) => ({ id }));
    const requested: Array<[number, number]> = [];
    const result = await collectPagedShiftRows(async (from, to) => {
      requested.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual(rows);
    expect(requested).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it("batches large shift/order ID lists and paginates payments within each batch", async () => {
    const ids = Array.from({ length: 251 }, (_, id) => `order-${id}`);
    const batches: Array<{ ids: string[]; from: number; to: number }> = [];
    const result = await collectShiftRowsForIds(ids, async (batch, from, to) => {
      batches.push({ ids: batch, from, to });
      const rows = batch.flatMap(id => [0, 1, 2, 3, 4, 5].map(n => `${id}-payment-${n}`));
      return { data: rows.slice(from, to + 1), error: null };
    });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1506);
    expect(batches.map(({ ids: batch, from }) => [batch.length, from])).toEqual([
      [100, 0], [100, 500], [100, 0], [100, 500], [51, 0]
    ]);
  });

  it("fails closed on a database error instead of reporting partial financial totals", async () => {
    const result = await collectPagedShiftRows(async (from, to) =>
      from === 0
        ? { data: Array.from({ length: to + 1 }, (_, id) => ({ id })), error: null }
        : { data: null, error: { message: "database unavailable" } }
    );
    expect(result).toEqual({ data: null, error: { message: "database unavailable" } });
  });

  it("does not query Supabase for an empty ID list", async () => {
    let calls = 0;
    const result = await collectShiftRowsForIds([], async () => {
      calls++;
      return { data: [], error: null };
    });
    expect(result).toEqual({ data: [], error: null });
    expect(calls).toBe(0);
  });
});

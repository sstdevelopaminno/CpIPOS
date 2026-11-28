import { describe, expect, it } from "vitest";
import { transitionWarehouseTransfer, validateWarehouseTransfer, type WarehouseTransfer } from "../../src/lib/retail-wholesale/warehouse-transfer";

const draft = (): WarehouseTransfer => ({ status: "draft", lines: [{ sku: "A", quantity: 10, received: 0 }, { sku: "B", quantity: 4, received: 0 }] });
const approved = () => transitionWarehouseTransfer(draft(), { type: "approve" });
const dispatched = () => transitionWarehouseTransfer(approved(), { type: "dispatch" });

describe("warehouse transfer state rules", () => {
  it("approves, dispatches, partially receives and completes", () => {
    const original = dispatched();
    const partial = transitionWarehouseTransfer(original, { type: "receive", quantities: { A: 3, B: 4 } });
    expect(partial.status).toBe("partially_received");
    expect(partial.lines.map(line => line.received)).toEqual([3, 4]);
    expect(original.lines.map(line => line.received)).toEqual([0, 0]);
    const complete = transitionWarehouseTransfer(partial, { type: "receive", quantities: { A: 7 } });
    expect(complete.status).toBe("received");
    expect(complete.lines.map(line => line.received)).toEqual([10, 4]);
    expect(() => transitionWarehouseTransfer(complete, { type: "receive", quantities: { A: 1 } })).toThrow("INVALID_TRANSITION");
  });
  it("rejects dispatch without approval and receiving before dispatch", () => {
    expect(() => transitionWarehouseTransfer(draft(), { type: "dispatch" })).toThrow("INVALID_TRANSITION");
    expect(() => transitionWarehouseTransfer(approved(), { type: "receive", quantities: { A: 1 } })).toThrow("INVALID_TRANSITION");
  });
  it("allows cancellation only before dispatch", () => {
    expect(transitionWarehouseTransfer(draft(), { type: "cancel" }).status).toBe("cancelled");
    expect(transitionWarehouseTransfer(approved(), { type: "cancel" }).status).toBe("cancelled");
    expect(() => transitionWarehouseTransfer(dispatched(), { type: "cancel" })).toThrow("INVALID_TRANSITION");
  });
  it.each([{ A: 11 }, { A: -1 }, { A: 1.5 }, { A: NaN }, { A: Infinity }, { C: 1 }, { A: 0 }, {}])("rejects invalid receipts %j", quantities => {
    expect(() => transitionWarehouseTransfer(dispatched(), { type: "receive", quantities: quantities as Record<string, number> })).toThrow();
  });
  it("prevents receiving beyond the remaining quantity", () => {
    const partial = transitionWarehouseTransfer(dispatched(), { type: "receive", quantities: { A: 8 } });
    expect(() => transitionWarehouseTransfer(partial, { type: "receive", quantities: { A: 3 } })).toThrow("OVER_RECEIPT");
  });
  it("rejects empty, duplicate, inconsistent and fractional transfer lines", () => {
    expect(() => validateWarehouseTransfer({ status: "draft", lines: [] })).toThrow("EMPTY_TRANSFER");
    expect(() => validateWarehouseTransfer({ status: "draft", lines: [{ sku: "A", quantity: 2, received: 0 }, { sku: "A", quantity: 1, received: 0 }] })).toThrow("INVALID_TRANSFER_LINE");
    expect(() => validateWarehouseTransfer({ status: "received", lines: draft().lines })).toThrow("INVALID_TRANSFER_STATUS");
    expect(() => validateWarehouseTransfer({ status: "draft", lines: [{ sku: "A", quantity: 1.5, received: 0 }] })).toThrow("INVALID_TRANSFER_LINE");
  });
});

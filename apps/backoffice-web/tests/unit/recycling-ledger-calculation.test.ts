import { describe, expect, it } from "vitest";
import { applyStockValuation, getRecyclingLedgerRows, isBalanced } from "../../src/lib/recycling-ledger-calculation";

describe("Recycling weighted-average inventory and accounting parity", () => {
  it("receives 2.5kg for 20.63 THB, sells 1kg, then values 1.5kg at 12.38 THB", () => {
    const bought = applyStockValuation("buy",0n,0n,2_500_000n,2063n);
    expect(bought).toEqual({ quantityMicro: 2_500_000n,carryingCostMinor:2063n,cogsMinor:0n });
    const sold = applyStockValuation("sell",bought.quantityMicro,bought.carryingCostMinor,
      1_000_000n,1000n);
    expect(sold).toEqual({ quantityMicro:1_500_000n,carryingCostMinor:1238n,cogsMinor:825n });
    const buyEntry = getRecyclingLedgerRows("buy","cash",2063n,0n);
    const saleEntry = getRecyclingLedgerRows("sell","cash",1000n,sold.cogsMinor);
    expect(buyEntry.map(x => x.code)).toEqual(["1200","1100"]);
    expect(saleEntry.map(x => x.code)).toEqual(["1100","4100","5100","1200"]);
    expect(isBalanced(buyEntry)).toBe(true);
    expect(isBalanced(saleEntry)).toBe(true);
    expect(saleEntry.reduce((s,x)=>s+x.debit,0n)).toBe(1825n);
  });
  it("uses AR/AP for credit rather than pretending cash was settled", () => {
    expect(getRecyclingLedgerRows("buy","credit",500n,0n).map(r=>r.code))
      .toEqual(["1200","2100"]);
    expect(getRecyclingLedgerRows("sell","credit",900n,400n).map(r=>r.code))
      .toEqual(["1201","4100","5100","1200"]);
    expect(getRecyclingLedgerRows("sell","bank_transfer",900n,400n)[0].code).toBe("1110");
  });
  it("prevents stock from becoming negative and refunds all residual carrying cost on a complete sale", () => {
    expect(()=>applyStockValuation("sell",1_000_000n,500n,1_000_001n,1000n))
      .toThrow("recycling_stock_insufficient");
    expect(applyStockValuation("sell",1_000_000n,501n,1_000_000n,1000n))
      .toEqual({quantityMicro:0n,carryingCostMinor:0n,cogsMinor:501n});
  });
  it("rounds weighted-average COGS half-up and rejects negative/corrupt values", () => {
    const test = applyStockValuation("sell",2_000_000n,1001n,1_000_000n,1500n);
    expect(test.cogsMinor).toBe(501n);
    expect(test.carryingCostMinor).toBe(500n);
    expect(()=>applyStockValuation("buy",-1n,0n,1000n,1n)).toThrow();
    expect(()=>getRecyclingLedgerRows("buy","cash",200n,1n)).toThrow();
    expect(isBalanced([{code:"1200",debit:100n,credit:0n}])).toBe(false);
  });
});

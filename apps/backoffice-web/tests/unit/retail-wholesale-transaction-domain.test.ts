import { describe, expect, it } from "vitest";
import { receivePurchaseStock, issueSaleStock, prepareCreditSale, prepareCreditSettlement, previewSaleJournal, previewGoodsReceiptJournal, previewSupplierBillJournal, previewSettlementJournal, previewReversalJournal, validateJournalPreview } from "../../src/lib/retail-wholesale/transaction-domain";
describe("RW procurement and weighted inventory value",()=>{
  it("receives partial quantities and prevents excess receipt",()=>{
    const input={stock:{baseUnits:10,inventoryMinor:1000},orderedBaseUnits:24,alreadyReceivedBaseUnits:0,receivedBaseUnits:12,verifiedNetCostMinor:1440};
    const result=receivePurchaseStock(input);
    expect(result).toEqual({stock:{baseUnits:22,inventoryMinor:2440},receivedBaseUnits:12,remainingBaseUnits:12});
    expect(()=>receivePurchaseStock({...input,alreadyReceivedBaseUnits:13})).toThrow("rw_purchase_over_receipt");
  });
  it("conserves carrying value across repeated sales and final depletion",()=>{
    const first=issueSaleStock({baseUnits:3,inventoryMinor:100},1);
    const second=issueSaleStock(first.stock,1);
    const last=issueSaleStock(second.stock,1);
    expect(first.cogsMinor+second.cogsMinor+last.cogsMinor).toBe(100);
    expect(last.stock).toEqual({baseUnits:0,inventoryMinor:0});
    expect(()=>issueSaleStock(first.stock,3)).toThrow("rw_stock_insufficient");
  });
});
describe("RW credit domain",()=>{
  const sale={customerActive:true,creditLimitMinor:100000,verifiedOutstandingMinor:50000,saleTotalMinor:30000,documentDate:"2026-11-27",dueDate:"2026-12-27"};
  it("checks credit limit and actual due date",()=>{
    expect(prepareCreditSale(sale).resultingOutstandingMinor).toBe(80000);
    expect(()=>prepareCreditSale({...sale,saleTotalMinor:50001})).toThrow("rw_credit_limit_exceeded");
    expect(()=>prepareCreditSale({...sale,dueDate:"2026-02-30"})).toThrow("rw_invalid_date");
    expect(()=>prepareCreditSale({...sale,dueDate:"2026-11-26"})).toThrow("rw_credit_due_before_sale");
    expect(()=>prepareCreditSale({...sale,customerActive:false})).toThrow("rw_credit_customer_inactive");
  });
  it("rejects unverified transfer and overpayment",()=>{
    const pay={verifiedOutstandingMinor:80000,paymentMinor:20000,method:"bank_transfer" as const,evidenceVerified:true};
    expect(prepareCreditSettlement(pay).remainingMinor).toBe(60000);
    expect(()=>prepareCreditSettlement({...pay,evidenceVerified:false})).toThrow("rw_settlement_evidence_required");
    expect(()=>prepareCreditSettlement({...pay,paymentMinor:80001})).toThrow("rw_settlement_overpayment");
  });
});
describe("RW balanced journal previews — not live postings",()=>{
  it.each(["cash","bank_transfer","credit"] as const)("balances sale and COGS for %s",payment=>{
    const journal=previewSaleJournal({grossMinor:10700,outputVatMinor:700,taxSourceVerified:true,cogsMinor:6000,payment,settlementVerified:true});
    expect(journal.debitTotalMinor).toBe(16700);
    expect(journal.creditTotalMinor).toBe(16700);
    expect(journal.lines.some(line=>line.accountRole==="cost_of_goods_sold"&&line.debitMinor===6000)).toBe(true);
    expect(previewReversalJournal(journal.lines).debitTotalMinor).toBe(16700);
  });
  it("separates receipt stock from supplier invoice and AP settlement",()=>{
    expect(previewGoodsReceiptJournal(10000).lines).toContainEqual({accountRole:"goods_received_not_invoiced",debitMinor:0,creditMinor:10000});
    const bill=previewSupplierBillJournal({grossMinor:10700,inputVatMinor:700,taxSourceVerified:true,verifiedUnbilledReceiptMinor:10000});
    expect(bill.lines.some(line=>line.accountRole==="inventory")).toBe(false);
    expect(bill.lines).toContainEqual({accountRole:"accounts_payable",debitMinor:0,creditMinor:10700});
    expect(previewSettlementJournal({direction:"pay",method:"cash",verifiedOutstandingMinor:10700,paymentMinor:5000,evidenceVerified:true}).remainingMinor).toBe(5700);
  });
  it("rejects unverified tax, unmatched receipt and unbalanced lines",()=>{
    expect(()=>previewSupplierBillJournal({grossMinor:10700,inputVatMinor:700,taxSourceVerified:false,verifiedUnbilledReceiptMinor:10000})).toThrow("rw_tax_source_unverified");
    expect(()=>previewSupplierBillJournal({grossMinor:10700,inputVatMinor:700,taxSourceVerified:true,verifiedUnbilledReceiptMinor:9000})).toThrow("rw_supplier_bill_receipt_mismatch");
    expect(()=>validateJournalPreview([{accountRole:"cash",debitMinor:100,creditMinor:0},{accountRole:"sales_revenue",debitMinor:0,creditMinor:99}])).toThrow("rw_journal_unbalanced");
  });
});

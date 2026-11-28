/** Pure RW transaction preparation. No database write, payment or GL posting.
 * All amounts are integer THB satang and stock is integer base units.
 * A server/RPC must load, lock and verify every input against authoritative
 * tenant/branch/product/customer records before using these calculations.
 */
const MAX = 99999999999999;
function int(value: number, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > MAX) throw new Error("rw_invalid_integer");
  return value;
}
function bounded(value: bigint) {
  if (value < BigInt(0) || value > BigInt(MAX)) throw new Error("rw_amount_overflow");
  return Number(value);
}
function sum(a:number,b:number) { return bounded(BigInt(int(a)) + BigInt(int(b))); }

export type StockValue = { baseUnits: number; inventoryMinor: number };
function validateStock(stock: StockValue) {
  int(stock.baseUnits); int(stock.inventoryMinor);
  if (stock.baseUnits === 0 && stock.inventoryMinor !== 0) throw new Error("rw_stock_value_without_units");
}
export function receivePurchaseStock(input: {
  stock: StockValue; orderedBaseUnits: number; alreadyReceivedBaseUnits: number;
  receivedBaseUnits: number; verifiedNetCostMinor: number;
}) {
  validateStock(input.stock);
  const ordered = int(input.orderedBaseUnits, 1);
  const already = int(input.alreadyReceivedBaseUnits);
  const received = int(input.receivedBaseUnits, 1);
  if (already > ordered || received > ordered - already) throw new Error("rw_purchase_over_receipt");
  const stock = { baseUnits: sum(input.stock.baseUnits, received), inventoryMinor: sum(input.stock.inventoryMinor, int(input.verifiedNetCostMinor, 1)) };
  return { stock, receivedBaseUnits: sum(already, received), remainingBaseUnits: ordered - already - received };
}

/** Allocate the exact carrying value proportionally; use half-up rounding in
 * satang and consume every remaining satang when the final units leave stock.
 */
export function issueSaleStock(stock: StockValue, baseUnits: number) {
  validateStock(stock);
  const units = int(baseUnits, 1);
  if (units > stock.baseUnits) throw new Error("rw_stock_insufficient");
  const numerator = BigInt(stock.inventoryMinor) * BigInt(units);
  const denominator = BigInt(stock.baseUnits);
  const cogsMinor = units === stock.baseUnits ? stock.inventoryMinor
    : bounded((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
  return { cogsMinor, stock: { baseUnits: stock.baseUnits - units, inventoryMinor: stock.inventoryMinor - cogsMinor } };
}

function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("rw_invalid_date");
  const parsed = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== value) throw new Error("rw_invalid_date");
  return value;
}
export function prepareCreditSale(input:{
  customerActive: boolean; creditLimitMinor: number; verifiedOutstandingMinor: number;
  saleTotalMinor: number; documentDate: string; dueDate: string;
}) {
  if (input.customerActive !== true) throw new Error("rw_credit_customer_inactive");
  const limit = int(input.creditLimitMinor);
  const outstanding = int(input.verifiedOutstandingMinor);
  const sale = int(input.saleTotalMinor,1);
  if (dateOnly(input.dueDate) < dateOnly(input.documentDate)) throw new Error("rw_credit_due_before_sale");
  const resultingOutstandingMinor = sum(outstanding,sale);
  if (resultingOutstandingMinor > limit) throw new Error("rw_credit_limit_exceeded");
  return { resultingOutstandingMinor, remainingCreditMinor: limit - resultingOutstandingMinor, dueDate: input.dueDate };
}
export type SettlementMethod = "cash" | "bank_transfer";
export function prepareCreditSettlement(input:{
  verifiedOutstandingMinor:number; paymentMinor:number; method:SettlementMethod;
  evidenceVerified:boolean;
}) {
  if (input.method !== "cash" && input.method !== "bank_transfer") throw new Error("rw_invalid_settlement_method");
  if (input.evidenceVerified !== true) throw new Error("rw_settlement_evidence_required");
  const outstanding = int(input.verifiedOutstandingMinor,1);
  const amount = int(input.paymentMinor,1);
  if (amount > outstanding) throw new Error("rw_settlement_overpayment");
  return { paidMinor:amount, remainingMinor:outstanding-amount };
}

export type AccountRole = "cash"|"bank"|"accounts_receivable"|"accounts_payable"|"sales_revenue"|"output_vat"|"input_vat"|"inventory"|"cost_of_goods_sold"|"goods_received_not_invoiced";
export type JournalPreviewLine = { accountRole:AccountRole; debitMinor:number; creditMinor:number };
function debit(accountRole:AccountRole,amount:number):JournalPreviewLine { return {accountRole,debitMinor:int(amount,1),creditMinor:0}; }
function credit(accountRole:AccountRole,amount:number):JournalPreviewLine { return {accountRole,debitMinor:0,creditMinor:int(amount,1)}; }
export function validateJournalPreview(lines: JournalPreviewLine[]) {
  if (lines.length < 2 || lines.length > 100) throw new Error("rw_journal_lines_invalid");
  let debitTotalMinor=0, creditTotalMinor=0;
  for (const line of lines) {
    int(line.debitMinor); int(line.creditMinor);
    if ((line.debitMinor===0)===(line.creditMinor===0)) throw new Error("rw_journal_line_invalid");
    debitTotalMinor=sum(debitTotalMinor,line.debitMinor); creditTotalMinor=sum(creditTotalMinor,line.creditMinor);
  }
  if (debitTotalMinor!==creditTotalMinor || debitTotalMinor===0) throw new Error("rw_journal_unbalanced");
  return {lines,debitTotalMinor,creditTotalMinor};
}
function verifiedTax(total:number,tax:number,verified:boolean) {
  int(total,1); int(tax);
  if(tax>=total || (tax>0 && verified!==true)) throw new Error("rw_tax_source_unverified");
  return total-tax;
}
export function previewSaleJournal(input:{
  grossMinor:number; outputVatMinor:number; taxSourceVerified:boolean; cogsMinor:number;
  payment:"cash"|"bank_transfer"|"credit"; settlementVerified:boolean;
}) {
  const net=verifiedTax(input.grossMinor,input.outputVatMinor,input.taxSourceVerified);
  int(input.cogsMinor);
  if(input.payment!=="cash"&&input.payment!=="bank_transfer"&&input.payment!=="credit")throw new Error("rw_sale_payment_invalid");
  // Credit verification means approved customer/credit terms, not money received.
  if(input.settlementVerified!==true)throw new Error("rw_sale_settlement_unverified");
  const asset:AccountRole=input.payment==="cash"?"cash":input.payment==="bank_transfer"?"bank":"accounts_receivable";
  const lines=[debit(asset,input.grossMinor),credit("sales_revenue",net)];
  if(input.outputVatMinor)lines.push(credit("output_vat",input.outputVatMinor));
  if(input.cogsMinor)lines.push(debit("cost_of_goods_sold",input.cogsMinor),credit("inventory",input.cogsMinor));
  return validateJournalPreview(lines);
}
/** Receive goods once: credit GRNI, not AP. Supplier invoice clears GRNI;
 * never debit inventory a second time for the same receipt. */
export function previewGoodsReceiptJournal(verifiedNetCostMinor:number) {
  return validateJournalPreview([debit("inventory",verifiedNetCostMinor),credit("goods_received_not_invoiced",verifiedNetCostMinor)]);
}
export function previewSupplierBillJournal(input:{grossMinor:number;inputVatMinor:number;taxSourceVerified:boolean;verifiedUnbilledReceiptMinor:number}) {
  const net=verifiedTax(input.grossMinor,input.inputVatMinor,input.taxSourceVerified);
  if(net!==int(input.verifiedUnbilledReceiptMinor,1))throw new Error("rw_supplier_bill_receipt_mismatch");
  const lines=[debit("goods_received_not_invoiced",net),credit("accounts_payable",input.grossMinor)];
  if(input.inputVatMinor)lines.push(debit("input_vat",input.inputVatMinor));
  return validateJournalPreview(lines);
}
export function previewSettlementJournal(input:{direction:"receive"|"pay";method:SettlementMethod;verifiedOutstandingMinor:number;paymentMinor:number;evidenceVerified:boolean}) {
  const settlement=prepareCreditSettlement(input);
  if(input.direction!=="receive"&&input.direction!=="pay")throw new Error("rw_settlement_direction_invalid");
  const money:AccountRole=input.method==="cash"?"cash":"bank";
  const lines=input.direction==="receive"
    ?[debit(money,settlement.paidMinor),credit("accounts_receivable",settlement.paidMinor)]
    :[debit("accounts_payable",settlement.paidMinor),credit(money,settlement.paidMinor)];
  return {...settlement,...validateJournalPreview(lines)};
}
export function previewReversalJournal(original:JournalPreviewLine[]) {
  validateJournalPreview(original);
  return validateJournalPreview(original.map(line=>({...line,debitMinor:line.creditMinor,creditMinor:line.debitMinor})));
}

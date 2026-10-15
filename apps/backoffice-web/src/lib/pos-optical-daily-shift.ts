/**
 * CUSTOM Optical operates one local business-day shift, not food's three slots.
 * This is a read-only planning/reconciliation policy. Real auto-closing requires
 * the existing guarded close workflow to execute at the deadline (server side).
 * Never infer a US store's timezone solely from USD.
 */
export type OpticalCountry = "TH" | "LA" | "US";
export type OpticalCurrency = "THB" | "LAK" | "USD";
export type OpticalShiftSchedule = {
  country: OpticalCountry;
  currency: OpticalCurrency;
  timeZone: string;
  openedAt: Date;
  cutoffAt: Date;
  warningAt: Date;
  autoCloseAt: Date;
};

const currencyByCountry: Record<OpticalCountry,OpticalCurrency> = {
  TH: "THB", LA: "LAK", US: "USD"
};
const defaultTimeZone: Partial<Record<OpticalCountry,string>> = {
  TH: "Asia/Bangkok", LA: "Asia/Vientiane"
};

/** US must have an explicit IT-approved IANA timezone (DST-safe). */
export function resolveOpticalTimeZone(
  country: OpticalCountry,
  approvedTimeZone?: string | null
): string | null {
  const zone = approvedTimeZone?.trim() || defaultTimeZone[country];
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US",{ timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function localDateKey(date: Date,timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US",{
    timeZone, year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const take = (name: string) => parts.find(x => x.type === name)?.value ?? "";
  return `${take("year")}-${take("month")}-${take("day")}`;
}

/** Binary search the first instant of the following civil day. Handles US DST. */
export function nextOpticalMidnightUtc(openedAt: Date,timeZone: string): Date | null {
  if (!Number.isFinite(openedAt.getTime())) return null;
  try {
    const key = localDateKey(openedAt,timeZone);
    let lo=openedAt.getTime(),hi=lo+27*60*60*1000;
    if (localDateKey(new Date(hi),timeZone) <= key) return null;
    while (hi-lo>1) {
      const mid=Math.floor((lo+hi)/2);
      if (localDateKey(new Date(mid),timeZone)>key) hi=mid;
      else lo=mid;
    }
    return new Date(hi);
  } catch {
    return null;
  }
}

export function resolveOpticalDailyShift(args:{
  openedAt:string|Date;
  country:OpticalCountry;
  approvedTimeZone?:string|null;
}): OpticalShiftSchedule|null {
  const openedAt=args.openedAt instanceof Date ? args.openedAt:new Date(args.openedAt);
  const timeZone=resolveOpticalTimeZone(args.country,args.approvedTimeZone);
  if (!timeZone) return null;
  const cutoffAt=nextOpticalMidnightUtc(openedAt,timeZone);
  if (!cutoffAt) return null;
  return {
    country:args.country,currency:currencyByCountry[args.country],
    timeZone,openedAt,cutoffAt,
    warningAt:new Date(cutoffAt.getTime()+30*60*1000),
    autoCloseAt:new Date(cutoffAt.getTime()+45*60*1000)
  };
}

export type OpticalLedgerPayment = {
  shift_id:string;
  branch_id:string;
  work_order_id:string;
  request_id:string;
  method:string;
  currency_code:string;
  amount:number;
  cumulative_paid:number;
  received_at:string;
  verified_by:string|null;
};
export type OpticalWorkOrderTotal = {
  id:string;
  branch_id:string;
  total_amount:number;
  currency_code:string;
};

/**
 * Deposit = verified receipt while work order is not yet fully paid.
 * This is cash received as a liability, never additional completed-sale revenue.
 * The final balance collection is not counted again as a deposit.
 */
export function sumVerifiedOpticalDeposits(args:{
  shiftId:string;
  branchId:string;
  currency:OpticalCurrency;
  received:OpticalLedgerPayment[];
  orders:OpticalWorkOrderTotal[];
  openedAt:Date;
  cutoffAt:Date;
}): {deposit_total:number;deposit_cash:number;deposit_transfer:number;deposit_count:number} {
  const totals={deposit_total:0,deposit_cash:0,deposit_transfer:0,deposit_count:0};
  const byOrder=new Map(args.orders.filter(x=>x.branch_id===args.branchId&&x.currency_code===args.currency)
    .map(x=>[x.id,x]));
  const requests=new Set<string>();
  for (const payment of args.received) {
    if (payment.shift_id!==args.shiftId||payment.branch_id!==args.branchId ||
      payment.currency_code!==args.currency || !payment.request_id || requests.has(payment.request_id)) continue;
    const order=byOrder.get(payment.work_order_id);
    const amount=Number(payment.amount),cumulative=Number(payment.cumulative_paid);
    const when=Date.parse(payment.received_at);
    if (!order || !Number.isFinite(amount) || amount<=0 || !Number.isFinite(cumulative) ||
      !Number.isFinite(when) || when<args.openedAt.getTime()||when>=args.cutoffAt.getTime() ||
      cumulative>=Number(order.total_amount) || cumulative<=0) continue;
    if (payment.method==="bank_transfer" && !payment.verified_by) continue;
    if (payment.method!=="cash"&&payment.method!=="bank_transfer") continue;
    requests.add(payment.request_id);
    totals.deposit_total+=amount;
    if(payment.method==="cash") totals.deposit_cash+=amount;
    else totals.deposit_transfer+=amount;
    totals.deposit_count++;
  }
  return {
    deposit_total:Number(totals.deposit_total.toFixed(2)),
    deposit_cash:Number(totals.deposit_cash.toFixed(2)),
    deposit_transfer:Number(totals.deposit_transfer.toFixed(2)),
    deposit_count:totals.deposit_count
  };
}

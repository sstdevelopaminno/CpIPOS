export type MoneyRecyclingRow = {
  direction:"buy"|"sell";settlement:"cash"|"bank_transfer"|"credit";
  status:"posted"|"voided";total_minor:number;cogs_minor:number
};
export type RecyclingReportMoney = {
 buyCount:number;sellCount:number;voidCount:number;buyMinor:number;sellMinor:number;cogsMinor:number;
 cashInMinor:number;cashOutMinor:number;transferInMinor:number;transferOutMinor:number;
 creditInMinor:number;creditOutMinor:number;
};
/** Purchases are an OUTGOING payment, not a negative sale. Exclude VOID from ledgers. */
export function sumRecyclingReportMoney(rows:MoneyRecyclingRow[]):RecyclingReportMoney{
 const result:RecyclingReportMoney={buyCount:0,sellCount:0,voidCount:0,buyMinor:0,sellMinor:0,cogsMinor:0,
 cashInMinor:0,cashOutMinor:0,transferInMinor:0,transferOutMinor:0,creditInMinor:0,creditOutMinor:0};
 for(const row of rows){
  if(!Number.isSafeInteger(Number(row.total_minor))||!Number.isSafeInteger(Number(row.cogs_minor))||
    row.total_minor<0||row.cogs_minor<0)throw new Error("recycling_report_unsafe_amount");
  if(row.status==="voided"){result.voidCount++;continue;}
  const buy=row.direction==="buy",amount=Number(row.total_minor);
  if(buy){result.buyCount++;result.buyMinor+=amount;}else{result.sellCount++;result.sellMinor+=amount;result.cogsMinor+=Number(row.cogs_minor);}
  const key=row.settlement==="cash"?(buy?"cashOutMinor":"cashInMinor"):
    row.settlement==="bank_transfer"?(buy?"transferOutMinor":"transferInMinor"):(buy?"creditOutMinor":"creditInMinor");
  result[key]+=amount;
 }
 for(const amount of Object.values(result))if(!Number.isSafeInteger(amount))throw new Error("recycling_report_total_overflow");
 return result;
}

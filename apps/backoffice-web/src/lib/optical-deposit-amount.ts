export type OpticalDepositCurrency="THB"|"LAK"|"USD";
export type OpticalDepositMethod="cash"|"bank_transfer";
export function sanitizeOpticalDepositInput(value:string,currency:OpticalDepositCurrency):string{
  const cleaned=String(value??"").replace(/[^0-9.]/g,"");
  const [integer="",...fraction]=cleaned.split(".");
  const whole=integer.slice(0,10).replace(/^0+(?=\d)/,"")||"0";
  if(currency==="LAK")return whole;
  if(!fraction.length)return cleaned.endsWith(".")?whole+".":whole;
  return whole+"."+fraction.join("").slice(0,2);
}
export function resolveOpticalDeposit(value:string,total:number,currency:OpticalDepositCurrency):number|null{
  const amount=Number(value);
  const factor=currency==="LAK"?1:100;
  if(!Number.isFinite(amount)||!Number.isFinite(total)||amount<=0||total<=0)return null;
  if(amount>total||Math.abs(amount*factor-Math.round(amount*factor))>1e-6)return null;
  return Math.round(amount*factor)/factor;
}

/**
 * Resolve positive weight readings joined by '+' into a single quantity in
 * the catalogue's configured unit. Integer micro-kilograms avoid cumulative
 * floating point rounding. No arithmetic evaluation, inferred units or
 * silent truncation; malformed/incomplete readings never reach the cart.
 */
export const MAX_RECYCLING_WEIGHT_EXPRESSION_LENGTH=512;
export type RecyclingWeightTotal={quantity:number;display:string};
export function parseRecyclingWeightExpression(raw:string,unit:string):RecyclingWeightTotal|null{
  if(raw.length>MAX_RECYCLING_WEIGHT_EXPRESSION_LENGTH)return null;
  // One unit corresponds to 10^digits micro-kg, matching calculateRecyclingLine.
  const digits=unit==="ton"?9:unit==="kg"?6:unit==="khid"?5:unit==="g"?3:null;
  if(digits===null)return null;
  const expression=raw.trim().replace(/=$/,"").trim();
  if(!expression)return null;
  const terms=expression.split("+");
  if(terms.length>64)return null;
  const scale=10n**BigInt(digits);
  let total=0n;
  for(const part of terms){
    const match=/^(?:(\d{1,12})(?:\.(\d{0,9}))?|\.(\d{1,9}))$/.exec(part.trim());
    if(!match)return null;
    const fraction=(match[2]??match[3]??"").replace(/0+$/,"");
    if(fraction.length>digits)return null;
    const micros=BigInt(match[1]??"0")*scale+BigInt(fraction.padEnd(digits,"0")||"0");
    total+=micros;
    if(total>100_000_000_000_000n)return null;
  }
  // Match the existing minimum of 0.001 kg and maximum of 100M kg.
  if(total<1000n)return null;
  const whole=total/scale;
  const fraction=(total%scale).toString().padStart(digits,"0").replace(/0+$/,"");
  const display=whole.toString()+(fraction?"."+fraction:"");
  return {quantity:Number(display),display};
}

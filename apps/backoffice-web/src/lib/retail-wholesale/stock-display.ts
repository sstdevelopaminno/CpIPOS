/** No guessed cost or inherited retail price masquerades as RW pricing. */
export function explicitRetailPrice(raw: unknown): number | null {
  if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim()==="")) return null;
  const n=Number(raw);
  return Number.isFinite(n)&&n>=0 ? n : null;
}
export function estimateRetailStockCost(lines: Array<{quantity:number;cost:unknown}>): number|null {
  if (!lines.length) return null;
  let sum=0;
  for(const line of lines) {
    const cost=explicitRetailPrice(line.cost);
    if(!Number.isFinite(line.quantity)||line.quantity<=0||cost===null||cost===0)return null;
    sum+=line.quantity*cost;
  }
  return Number.isFinite(sum)?Math.round(sum*100)/100:null;
}

/**
 * Local, cashier-only held Recycling carts. Never mixes with ordinary POS held
 * bills, order tables or accounting. Each storage key is scoped by tenant,
 * branch, terminal, and the exact daily Recycling shift.
 */
export type HeldRecyclingLine={
  productId:string;
  unit:"kg"|"khid"|"g"|"ton"|"piece"|"stem";
  quantity:number;
  unitPrice:number;
};
export type HeldRecyclingBill={
  id:string;
  heldAt:string;
  direction:"buy"|"sell";
  shiftId:string;
  lines:HeldRecyclingLine[];
};
const validUnits=new Set(["kg","khid","g","ton","piece","stem"]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function recyclingHeldKey(
  tenantId:string,branchId:string,deviceCode:string|null,shiftId:string
):string{
  return ["cpipos","recycling","held-v1",tenantId,branchId,deviceCode??"no-device",shiftId].join(":");
}
export function parseRecyclingHeldBills(value:string|null,shiftId:string):HeldRecyclingBill[]{
  if(!value || !uuid.test(shiftId))return [];
  try{
    const parsed:unknown=JSON.parse(value);
    if(!Array.isArray(parsed))return [];
    return parsed.filter((row):row is HeldRecyclingBill=>{
      if(!row||typeof row!=="object"||Array.isArray(row))return false;
      const v=row as Partial<HeldRecyclingBill>;
      return typeof v.id==="string"&&uuid.test(v.id)&&v.shiftId===shiftId&&
        (v.direction==="buy"||v.direction==="sell")&&
        typeof v.heldAt==="string"&&Number.isFinite(Date.parse(v.heldAt))&&
        Array.isArray(v.lines)&&v.lines.length>0&&v.lines.length<=100&&
        v.lines.every(line=>line&&typeof line==="object"&&
          typeof line.productId==="string"&&uuid.test(line.productId)&&
          validUnits.has(line.unit)&&Number.isFinite(line.quantity)&&line.quantity>0&&
          Number.isFinite(line.unitPrice)&&line.unitPrice>=0);
    }).slice(0,30);
  }catch{return [];}
}

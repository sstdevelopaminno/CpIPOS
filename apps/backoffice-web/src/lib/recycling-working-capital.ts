/**
 * Cash available for Recycling purchases is cash physically in the drawer.
 * A bank GL balance, unverified transfer or open receivable cannot fund a
 * cash purchase. This helper is for on-screen reconciliation only; the
 * database transaction RPC remains authoritative for financial writes.
 */
export function recyclingExpectedDrawerMinor(args:{
  openingMinor:number|null;cashInMinor:number;cashOutMinor:number;
}):number|null{
  const {openingMinor,cashInMinor,cashOutMinor}=args;
  if(openingMinor===null)return null;
  if(![openingMinor,cashInMinor,cashOutMinor].every(Number.isSafeInteger) ||
     openingMinor<0||cashInMinor<0||cashOutMinor<0)return null;
  const expected=openingMinor+cashInMinor-cashOutMinor;
  return Number.isSafeInteger(expected)&&expected>=0?expected:null;
}

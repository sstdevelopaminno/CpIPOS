export type VatRegistrationInput = {
  tax_id:string;legal_name:string;legal_address:string;branch_no:string;
  evidence_reference:string;verified_from:string;verified_until:string|null;
};

function dateValid(value:string):boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d=new Date(value+"T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value;
}
export function parseVatRegistration(raw:unknown,today:string):VatRegistrationInput|null {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const data=raw as Record<string,unknown>;
  if(data.confirmed!==true)return null;
  const read=(key:string)=>typeof data[key]==="string"?(data[key] as string).trim():"";
  const tax_id=read("tax_id"),legal_name=read("legal_name"),legal_address=read("legal_address");
  const branch_no=read("branch_no"),evidence_reference=read("evidence_reference");
  const verified_from=read("verified_from"),verified_until=read("verified_until")||null;
  if(!/^\d{13}$/.test(tax_id)||!/^\d{5}$/.test(branch_no)||
    legal_name.length<2||legal_name.length>240||legal_address.length<5||legal_address.length>1000||
    evidence_reference.length<5||evidence_reference.length>500||
    !dateValid(verified_from)||verified_from>today||
    (verified_until!==null&&(!dateValid(verified_until)||verified_until<today||verified_until<verified_from)))return null;
  return {tax_id,legal_name,legal_address,branch_no,evidence_reference,verified_from,verified_until};
}

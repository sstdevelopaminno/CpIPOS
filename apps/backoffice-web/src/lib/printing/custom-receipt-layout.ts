export const RECEIPT_FIELDS=["logo","shop","address","phone","branch","seller","mode","number","date","time","footer"] as const;
export type ReceiptField=typeof RECEIPT_FIELDS[number];
export type ReceiptVisibility=Record<ReceiptField,boolean>;
export const RECEIPT_LAYOUT_MODES=["recycling","shared"] as const;
export type ReceiptLayoutMode=typeof RECEIPT_LAYOUT_MODES[number];
export function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
export function normalizeReceiptVisibility(value:unknown):ReceiptVisibility{
 const obj=record(value);
 return Object.fromEntries(RECEIPT_FIELDS.map(key=>[key,obj[key]!==false])) as ReceiptVisibility;
}
export function validReceiptVisibility(value:unknown):boolean{
 const obj=record(value);return Object.keys(obj).length===RECEIPT_FIELDS.length&&RECEIPT_FIELDS.every(key=>typeof obj[key]==="boolean");
}
export function receiptVisibilityFromMetadata(metadata:unknown,branchId:string,mode:ReceiptLayoutMode):ReceiptVisibility|undefined{
 const branch=record(record(record(metadata).custom_receipt_layout_v1)[branchId]);
 return validReceiptVisibility(record(branch[mode]).fields)?normalizeReceiptVisibility(record(branch[mode]).fields):undefined;
}
export function receiptDateText(iso:string,fields:ReceiptVisibility|undefined,language:"th"|"en"|"lo"="th",shortDate=false,seconds=false):string{
 if(fields?.date===false&&fields.time===false)return "";
 const parsed=new Date(iso);
 if(!Number.isFinite(parsed.getTime()))return fields&&(fields.date===false||fields.time===false)?"":iso;
 const locale=language==="lo"?"lo-LA":language==="en"?"en-US":"th-TH";
 const options:Intl.DateTimeFormatOptions={timeZone:language==="lo"?"Asia/Vientiane":"Asia/Bangkok"};
 if(fields?.date!==false)options.dateStyle=shortDate?"short":"medium";
 if(fields?.time!==false)options.timeStyle=seconds?"medium":"short";
 return new Intl.DateTimeFormat(locale,options).format(parsed);
}

import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {requireCustomBrandingTenant} from "@/lib/server/custom-branding";
import {receiptVisibilityFromMetadata,record,type ReceiptVisibility,type ReceiptLayoutMode} from "@/lib/printing/custom-receipt-layout";
export async function resolveCustomReceiptVisibility(tenantId:string,branchId:string,metadata:unknown,mode:ReceiptLayoutMode){
 const fields=receiptVisibilityFromMetadata(metadata,branchId,mode);
 if(!fields)return undefined;
 return await requireCustomBrandingTenant(tenantId)?fields:undefined;
}
export async function readReceiptLayoutMetadata(tenantId:string){
 const result=await getSupabaseServiceClient().from("tenants").select("metadata").eq("id",tenantId).maybeSingle();
 if(result.error||!result.data)throw Error("receipt_layout_unavailable");
 return result.data.metadata as unknown;
}
export async function saveReceiptLayout(tenantId:string,branchId:string,actorId:string,mode:ReceiptLayoutMode,fields:ReceiptVisibility){
 const db=getSupabaseServiceClient();
 const before=await readReceiptLayoutMetadata(tenantId);
 if(before!==null&&(typeof before!=="object"||Array.isArray(before)))throw Error("receipt_layout_invalid_metadata");
 const meta=record(before),all=record(meta.custom_receipt_layout_v1),branch=record(all[branchId]);
 const next={...meta,custom_receipt_layout_v1:{...all,[branchId]:{...branch,[mode]:{fields,updated_by:actorId,updated_at:new Date().toISOString()}}}};
 // Compare-and-swap prevents concurrent writes to unrelated metadata being lost.
 let q=db.from("tenants").update({metadata:next}).eq("id",tenantId);
 q=before===null?q.is("metadata",null):q.eq("metadata",JSON.stringify(before));
 const result=await q.select("id").maybeSingle();
 if(result.error)throw Error("receipt_layout_save_failed");
 if(!result.data)throw Error("receipt_layout_conflict");
 return fields;
}

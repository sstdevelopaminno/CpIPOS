import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { isTenantPosMenuEnabled } from "@/lib/server/pos-menu-policy-service";
import { listAiDocuments, saveAiDocument } from "@/lib/services/ai-document-service";

export const runtime = "nodejs";

function scopeFrom(auth: Awaited<ReturnType<typeof getPosApiAuthContext>>) {
  if (!auth.tenantId || !auth.branchId) throw new Error("missing_pos_scope");
  return { tenantId: auth.tenantId, branchId: auth.branchId, userId: auth.userId };
}

async function guard() {
  const auth=await getPosApiAuthContext({requireBranchScope:true});
  if(auth.branchRole!=="owner" && auth.branchRole!=="manager") return {response:fail("ai_documents_forbidden","เอกสาร CpiPOS AI ใช้งานได้เฉพาะ Owner และ Manager",403)} as const;
  if(!auth.tenantId || !(await isTenantPosMenuEnabled(auth.tenantId,"main.ai_assistant"))) return {response:fail("ai_documents_disabled","CpiPOS AI ถูกปิดสำหรับร้านนี้",403)} as const;
  return {auth} as const;
}

export async function GET(){
  try{
    const checked=await guard(); if("response" in checked) return checked.response;
    const documents=await listAiDocuments(scopeFrom(checked.auth));
    return ok({documents});
  }catch(error){
    console.error("[cpipos-ai-documents] list failed",error);
    return fail("ai_documents_failed","ไม่สามารถโหลดเอกสาร AI ได้ในขณะนี้",500);
  }
}

export async function POST(request:Request){
  try{
    const checked=await guard(); if("response" in checked) return checked.response;
    const body=(await request.json().catch(()=>null)) as {title?:string;content?:string;room_id?:string|null;document_type?:string|null}|null;
    const document=await saveAiDocument({
      ...scopeFrom(checked.auth),
      title:String(body?.title??"").trim(),
      content:String(body?.content??"").trim(),
      sourceRoomId:String(body?.room_id??"").trim()||null,
      documentType:String(body?.document_type??"ai_summary")
    });
    return ok({document},201);
  }catch(error){
    const message=error instanceof Error?error.message:"";
    const status=/limit_reached/.test(message)?409:/content_required/.test(message)?422:500;
    console.error("[cpipos-ai-documents] save failed",error);
    return fail("ai_document_save_failed",status===409?"พื้นที่หรือจำนวนเอกสารของแพ็กเกจนี้เต็มแล้ว":"ไม่สามารถบันทึกเอกสาร AI ได้ในขณะนี้",status);
  }
}

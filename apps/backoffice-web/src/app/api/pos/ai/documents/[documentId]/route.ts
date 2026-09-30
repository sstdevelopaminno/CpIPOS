import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { deleteAiDocument, signedAiDocumentUrl } from "@/lib/services/ai-document-service";

export const runtime="nodejs";

function scopeFrom(auth: Awaited<ReturnType<typeof getPosApiAuthContext>>) {
  if(!auth.tenantId||!auth.branchId) throw new Error("missing_pos_scope");
  return {tenantId:auth.tenantId,branchId:auth.branchId,userId:auth.userId};
}
async function authScope(){
  const auth=await getPosApiAuthContext({requireBranchScope:true});
  if(auth.branchRole!=="owner"&&auth.branchRole!=="manager") return null;
  return {auth,scope:scopeFrom(auth)};
}
export async function GET(_request:Request,context:{params:Promise<{documentId:string}>}){
  try{
    const checked=await authScope(); if(!checked) return fail("ai_documents_forbidden","ไม่มีสิทธิ์เข้าถึงเอกสาร AI",403);
    const {documentId}=await context.params;
    const url=await signedAiDocumentUrl(checked.scope,documentId);
    if(!url) return fail("ai_document_not_found","ไม่พบเอกสาร",404);
    return ok({url,expires_in:300});
  }catch(error){ console.error("[cpipos-ai-documents] signed url failed",error); return fail("ai_document_open_failed","ไม่สามารถเปิดเอกสารได้",500); }
}
export async function DELETE(_request:Request,context:{params:Promise<{documentId:string}>}){
  try{
    const checked=await authScope(); if(!checked) return fail("ai_documents_forbidden","ไม่มีสิทธิ์ลบเอกสาร AI",403);
    const {documentId}=await context.params;
    await deleteAiDocument(checked.scope,documentId);
    return ok({deleted:true});
  }catch(error){ console.error("[cpipos-ai-documents] delete failed",error); return fail("ai_document_delete_failed","ไม่สามารถลบเอกสารได้",500); }
}

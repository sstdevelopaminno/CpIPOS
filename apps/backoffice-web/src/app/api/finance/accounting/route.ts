import { fail, ok } from "@/lib/http";
import {
  accountingIdentity, accountingBranches, accountingDocuments, accountingAging,
  accountingAccounts, accountingCreate, accountingTransition, accountingPost,
  accountingCreateAccount, FinanceAccountingError
} from "@/lib/server/finance-accounting-workflow";
import { todayBangkok } from "@/lib/finance-sales-analytics";
import { FinanceCoreError } from "@/lib/finance-accounting-core";

export const dynamic="force-dynamic";

function errorResponse(error:unknown) {
  if(error instanceof FinanceAccountingError)
    return fail(error.code,error.code,error.status);
  if(error instanceof FinanceCoreError)
    return fail(error.code,error.code,422);
  console.error("[finance/accounting] request failed",error instanceof Error?error.name:"unknown");
  return fail("finance_accounting_unavailable","Accounting service unavailable.",503);
}
function nonCache(response:Response) {
  response.headers.set("Cache-Control","private, no-store, max-age=0");
  return response;
}

export async function GET(request:Request) {
  try {
    const url=new URL(request.url);
    const view=url.searchParams.get("view")??"documents";
    const identity=await accountingIdentity("main.finance");
    const branch=url.searchParams.get("branchId");
    if(view==="branches")
      return nonCache(ok({branches:await accountingBranches(identity)}));
    if(view==="accounts")
      return nonCache(ok(await accountingAccounts(identity)));
    if(view==="aging") {
      const side=url.searchParams.get("side");
      if(side!=="AR" && side!=="AP")
        return fail("finance_accounting_aging_side_required","Specify AR or AP",422);
      return nonCache(ok(await accountingAging(identity,side,branch,url.searchParams.get("asOf")??todayBangkok())));
    }
    if(view!=="documents")
      return fail("finance_accounting_view_invalid","Invalid accounting view",422);
    return nonCache(ok(await accountingDocuments(identity,url.searchParams.get("kind")??"",branch)));
  } catch(error) { return errorResponse(error); }
}
export async function POST(request:Request) {
  try {
    const url=new URL(request.url);
    // An HttpOnly SameSite finance cookie is not sufficient protection for mutations.
    if(request.headers.get("origin")!==url.origin ||
      !request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return fail("finance_accounting_origin_forbidden","Same-origin JSON required",403);
    const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
    if(!body || typeof body!=="object" || Array.isArray(body))
      return fail("finance_accounting_payload_invalid","JSON object required",422);
    const identity=await accountingIdentity("main.finance");
    let result:unknown;
    switch(body.action) {
      case "create_document": result=await accountingCreate(identity,body); break;
      case "transition_document": result=await accountingTransition(identity,body); break;
      case "post_document": result=await accountingPost(identity,body); break;
      case "create_account": result=await accountingCreateAccount(identity,body); break;
      default: return fail("finance_accounting_action_invalid","Invalid accounting action",422);
    }
    return nonCache(ok(result));
  } catch(error) { return errorResponse(error); }
}

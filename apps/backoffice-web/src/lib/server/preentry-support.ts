import "server-only";
import {cookies} from "next/headers";
import {readPreEntryFlowState,hasFlowStage} from "@/lib/server/pre-entry-state";
import {issuePreEntrySupportChatBridge} from "@/lib/services/support-chat/support-chat-bridge";
export async function requirePreEntrySupport(){
 const flow=readPreEntryFlowState(await cookies());
 if(!flow||!hasFlowStage(flow,["employee_verified"])||!flow.tenantId||!flow.branchId||!flow.userId||!flow.userRole)
  throw new Error("preentry_employee_required");
 return {tenantId:flow.tenantId,branchId:flow.branchId,userId:flow.userId,role:flow.userRole,
   storeCode:flow.storeCode,storeName:flow.tenantName,employeeName:flow.employeeName||"พนักงาน"};
}
export async function issuePreEntryBridge(){
 const identity=await requirePreEntrySupport();
 const token=await issuePreEntrySupportChatBridge(identity);
 return {identity,token};
}

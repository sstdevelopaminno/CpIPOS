import { redirect } from "next/navigation";
import { PosAiDocumentVault } from "@/components/pos-preview/pos-ai-document-vault";
import { hasBranchFeature } from "@/lib/feature-gate";
import { requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed, isTenantPosMenuEnabled } from "@/lib/server/pos-menu-policy-service";

export const dynamic = "force-dynamic";

export default async function PosAiDocumentsPage() {
  const scope = await requirePosSession();
  if (scope.session.role !== "owner" && scope.session.role !== "manager") redirect("/preview/pos/more");
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/documents");
  if (!(await isTenantPosMenuEnabled(scope.session.tenant_id, "more.ai_documents"))) redirect("/preview/pos/more");
  if (!(await hasBranchFeature(scope.session.tenant_id, scope.session.branch_id, "ai_document_vault"))) {
    redirect("/preview/pos/payments/package");
  }
  return <PosAiDocumentVault />;
}

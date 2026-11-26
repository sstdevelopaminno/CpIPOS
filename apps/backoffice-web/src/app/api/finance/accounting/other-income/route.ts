import { fail, ok } from "@/lib/http";
import { accountingIdentity, accountingTransition, FinanceAccountingError } from "@/lib/server/finance-accounting-workflow";
import { createOtherIncome, listOtherIncome } from "@/lib/server/finance-other-income-service";
import { FinanceCoreError } from "@/lib/finance-accounting-core";

export const dynamic = "force-dynamic";

function respondError(error: unknown) {
  if (error instanceof FinanceAccountingError)
    return fail(error.code, error.code, error.status);
  if (error instanceof FinanceCoreError)
    return fail(error.code, error.code, 422);
  console.error("[finance/other-income] request failed", error instanceof Error ? error.name : "unknown");
  return fail("finance_accounting_unavailable", "Other-income service unavailable.", 503);
}
function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET(request: Request) {
  try {
    const identity = await accountingIdentity("finance.income");
    const params = new URL(request.url).searchParams;
    return privateResponse(ok(await listOtherIncome(identity, params.get("branchId"),{from:params.get("from"),to:params.get("to")})));
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (request.headers.get("origin") !== url.origin ||
        !request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return fail("finance_accounting_origin_forbidden", "Same-origin JSON required", 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return fail("finance_accounting_payload_invalid", "JSON object required", 422);
    const identity = await accountingIdentity("finance.income");
    if (body.action === "create")
      return privateResponse(ok(await createOtherIncome(identity, body)));
    if (body.action === "transition") {
      const result = await accountingTransition(identity, {
        documentId: body.documentId,
        version: body.version,
        transition: body.transition,
        reason: body.reason
      });
      return privateResponse(ok(result));
    }
    return fail("finance_accounting_action_invalid", "Unknown other-income action", 422);
  } catch (error) { return respondError(error); }
}

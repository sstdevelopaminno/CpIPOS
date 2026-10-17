import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { getTenantPosCurrencyCode } from "@/lib/server/custom-pos-currency";
import { fail, ok } from "@/lib/http";

/** Runtime read access does not grant any ability to change the sales currency. */
export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true });
    const currency_code = await getTenantPosCurrencyCode(auth.tenantId!);
    return ok({ currency_code });
  } catch {
    return fail("pos_currency_unavailable", "Unable to determine store sales currency.", 500);
  }
}

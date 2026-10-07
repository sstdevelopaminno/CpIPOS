import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("internal subscription slip scanner",()=>{
  const route=src("src/app/api/internal/subscription-slip-scan/route.ts");
  it("requires a service-derived internal bridge token and scoped evidence",()=>{
    expect(route).toContain("cpipos:internal-subscription-slip-scan:v1|");
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain('BUCKET="subscription-payment-evidence"');
    expect(route).toContain("expectedPrefix=tenantId+");
    expect(route).toContain("evidence_path_mismatch");
  });
  it("derives amount and recipient from the billing control plane",()=>{
    expect(route).toContain('rpc("subscription_billing_due_state"');
    expect(route).toContain("billing_bank_account_name");
    expect(route).toContain("billing_bank_account_number");
    expect(route).toContain("billing_promptpay_id");
    expect(route).toContain("Caller amount does not match billing control plane");
    expect(route).toContain("cents(parsed.amount)===cents(expectedAmount)");
  });
  it("only verifies a slip when amount, recipient, datetime, reference and confidence pass",()=>{
    expect(route).toContain("amount_match:amountMatch");
    expect(route).toContain("payee_match:payeeMatch");
    expect(route).toContain("reference_present:referencePresent");
    expect(route).toContain('verification.passed?"verified":"needs_review"');
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY:");
  });
});

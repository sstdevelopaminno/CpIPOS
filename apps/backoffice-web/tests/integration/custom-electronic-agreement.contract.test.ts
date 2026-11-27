import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(path:string)=>readFileSync(resolve(process.cwd(),"src",path),"utf8");
const api=src("app/api/pos/billing/custom-agreement/route.ts");
const ui=src("components/pos-preview/custom-agreement-acceptance.tsx");
const checkout=src("app/api/pos/billing/requests/route.ts");
const preentry=src("lib/services/public-package-checkout-service.ts");
const sql=readFileSync(resolve(process.cwd(),"../../docs/ops/custom-agreement-schema-candidate.sql"),"utf8");

describe("CUSTOM electronic agreement source contract (not live DB integration)",()=>{
  it("requires verified owner scope and explicit acceptance of the server-issued snapshot",()=>{
    expect(api).toContain('scope.session.role !== "owner"');
    expect(api).toContain('p_tenant_id:scope.session.tenant_id');
    expect(api).toContain('p_actor_user_id:scope.session.user_id');
    expect(api).toContain('data?.accepted !== true');
    expect(sql).toContain('p_expected_snapshot is distinct from v_snapshot');
    expect(sql).toContain('payment_request_id uuid not null unique');
    expect(ui).toContain('snapshot:evidence.snapshot');
  });
  it("activates only after a matching confirmed settlement, not a slip or provisional access",()=>{
    expect(sql).toContain('after insert on public.tenant_subscription_settlements');
    expect(sql).toContain('payment_request_id=new.payment_request_id');
    expect(sql).toContain('amount_per_cycle=new.amount_received and currency=new.currency');
    expect(sql).toContain('accepted_at<=new.bank_received_at');
    expect(sql).toContain("interval '12 months'");
    expect(sql).toContain('ends_at>new.bank_received_at');
    expect(checkout).not.toContain("tenant_custom_agreement_activations");
    expect(preentry).not.toContain("tenant_custom_agreement_activations");
  });
  it("does not expose acceptance tables or release unsigned draft terms",()=>{
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert");
    expect(api).toContain('VERSION.endsWith("-draft")');
    expect(api).toContain('process.env.CUSTOM_AGREEMENT_ENABLED !== "true"');
  });
});

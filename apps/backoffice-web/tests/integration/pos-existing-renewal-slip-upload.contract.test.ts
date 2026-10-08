import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");
const api = read("app/api/pos/billing/requests/route.ts");
const ui = read("components/pos-preview/pos-subscription-center.tsx");
const service = read("lib/services/pos-subscription-center-service.ts");

describe("POS evidence upload to existing renewal", () => {
  it("lets the owner submit a slip to an open renewal even when new payment checkout is disabled", () => {
    expect(ui).toContain('tab === "notice" && pendingCanAcceptPayment && !supportRequired');
    expect(ui).toContain("(selfServiceAllowed || completingPendingPayment)");
    expect(ui).toContain("pending.id : crypto.randomUUID()");
    expect(ui).toContain('form.set("request_key", requestKey.current)');
    expect(ui).toContain('form.set("slip", slip)');
  });

  it("only exempts an existing canonical open request, never a second payment notice", () => {
    expect(service).toContain("open_request_id:string|null");
    expect(api).toContain("const completingCanonicalOpenRequest = upgrading &&");
    expect(api).toContain("canonicalDue?.open_request_id === requestKey");
    expect(api).toContain('["pending", "under_review"].includes(canonicalDue?.open_request_status ?? "")');
    expect(api).toContain("canonicalDue?.self_service_payment_allowed === false && !completingCanonicalOpenRequest");
    expect(api).toContain('if (existing.data && (!upgrading || existing.data.id!==requestKey))');
    expect(api).toContain('.eq("requested_package_id",target.id)');
    expect(api).toContain('.is("evidence_url",null)');
  });

  it("never bypasses support restrictions or confirms bank settlement from a slip", () => {
    expect(api).toContain("canonicalDue?.support_required");
    expect(api).toContain('scope.session.role !== "owner"');
    expect(api).toContain("upsert:false");
    expect(api).toContain('status:"pending"');
    expect(api).not.toContain('status:"approved"');
  });
});

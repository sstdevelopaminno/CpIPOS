import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("POS subscription runtime stability",()=>{
  const guard=src("src/components/pos-preview/pos-subscription-lifecycle-guard.tsx");
  const session=src("src/lib/pos-session-guard.ts");
  const center=src("src/components/pos-preview/pos-subscription-center.tsx");
  const migration=src("../../supabase/migrations/20260929024000_subscription_runtime_realtime.sql");

  it("unlocks and refreshes from tenant-scoped realtime lifecycle events",()=>{
    expect(guard).toContain('table:"tenant_subscription_runtime"');
    expect(guard).toContain('cpipos-subscription-runtime-changed');
    expect(guard).toContain('fetch("/api/pos/billing/runtime"');
    expect(migration).toContain("app.has_tenant_access(tenant_id)");
    expect(migration).toContain("alter publication supabase_realtime add table public.tenant_subscription_runtime");
  });

  it("locks by client clock and routes payment to the actual package page",()=>{
    expect(guard).toContain("expiredByClock");
    expect(guard).toContain('pathname==="/preview/pos/payments/package"');
    expect(guard).toContain('router.push("/preview/pos/payments/package")');
  });

  it("does not cache a locked server-side sales decision",()=>{
    expect(session).toContain("cache.delete(tenantId)");
    expect(session).toContain("Math.min(now+POS_SUBSCRIPTION_ACTIVE_CACHE_TTL_MS,expiryAt)");
  });

  it("refreshes the package workspace automatically after approval",()=>{
    expect(center).toContain('"cpipos-subscription-runtime-changed"');
    expect(center).toContain("void reload()");
  });
});

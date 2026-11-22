import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";

const root=resolve(process.cwd(),"../..");
const readWeb=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const readRepo=(p:string)=>readFileSync(resolve(root,p),"utf8");

const migration=readRepo("supabase/migrations/20261122124500_recycling_tenant_receipt_sequence.sql");
const cashier=readWeb("src/components/pos/recycling-pos-workspace.tsx");
const currentRoute=readWeb("src/app/api/pos/recycling/shifts/current/route.ts");
const postRoute=readWeb("src/app/api/pos/recycling/transactions/route.ts");

describe("Recycling printable document numbering",()=>{
  it("allocates RCY-0001 then RCY-0002 atomically per tenant across both directions",()=>{
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.recycling_receipt_counters");
    expect(migration).toContain("tenant_id uuid PRIMARY KEY");
    expect(migration).toContain("last_number bigint NOT NULL");
    expect(migration).toContain("ON CONFLICT (tenant_id) DO UPDATE");
    expect(migration).toContain("last_number=public.recycling_receipt_counters.last_number+1");
    expect(migration).toContain("RETURN 'RCY-'||pg_catalog.lpad(v_value::text,4,'0');");
    expect(migration).toContain("v_receipt_no := public.recycling_allocate_receipt_no(p_tenant_id)");
    expect(migration).toContain("(tenant_id,receipt_no)");
    expect(migration).not.toContain("v_receipt_no := 'RCY-'||case p_direction");
  });
  it("protects existing audit receipt references and does not recycle VOID IDs",()=>{
    expect(migration).toContain("WHERE receipt_no ~ '^RCY-[0-9]{4,}$'");
    expect(migration).toContain("ON CONFLICT (tenant_id) DO UPDATE");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS recycling_transactions_tenant_receipt_unique");
    expect(migration).not.toContain("UPDATE public.recycling_transactions SET receipt_no");
    expect(migration).not.toContain("DELETE FROM public.recycling_transactions");
    expect(migration).toContain("request_id=p_request_id");
    expect(migration).toContain("'idempotent',true");
    expect(migration).toContain("if v_cash_balance_minor<0 then");
    expect(migration).toContain("recycling_stock_insufficient");
    expect(postRoute).toContain('db.rpc("recycling_post_transaction"');
  });
  it("locks down direct access to the sequence allocator",()=>{
    expect(migration).toContain("ALTER TABLE public.recycling_receipt_counters ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.recycling_receipt_counters FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.recycling_allocate_receipt_no(uuid)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.recycling_allocate_receipt_no(uuid) TO service_role");
  });
});

describe("Recycling cashier shift gate anti-flicker",()=>{
  it("does not block the screen on every visibility refresh or initial checking",()=>{
    expect(cashier).toContain('shiftGate==="checking" && <div role="status"');
    expect(cashier).toContain('shiftGate==="blocked" && <div data-testid="recycling-daily-shift-gate"');
    expect(cashier).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(cashier).toContain('gateInFlightRef.current');
    expect(cashier).toContain('if (document.visibilityState === "visible") void checkShift()');
    expect(cashier).not.toContain('setShiftGate("checking");\n        setShiftMessage("กำลังตรวจสอบสถานะกะ Recycling...")');
  });
  it("keeps a previously verified shift during only transient network/server failures",()=>{
    expect(cashier).toContain('shiftGateRef.current==="open"');
    expect(cashier).toContain('response.status>=500');
    expect(cashier).toContain('setShiftRefreshWarning(');
    expect(cashier).toContain('shiftGateRef.current="blocked"');
    expect(cashier).toContain("needs_join");
    expect(currentRoute).toContain("needs_join: Boolean(row && !isJoined)");
    expect(currentRoute).toContain("recyclingShiftIsToday(row.opened_at)");
    expect(postRoute).toContain('requireActiveShift(scope)');
    expect(postRoute).toContain('verifiedShift.data.status!=="open"');
  });
  it("resets stale shift only on business-day rollover",()=>{
    expect(cashier).toContain('shiftGateRef.current="checking"');
    expect(cashier).toContain("lastDayRef.current = today");
    expect(cashier).toContain('setShiftOpenedAt(""); setShiftId("")');
    expect(cashier).toContain('setLines([]); setPending(null)');
  });
});

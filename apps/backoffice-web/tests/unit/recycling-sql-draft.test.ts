import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// These are static release guards, NOT a substitute for executing the migrations
// on a separate PostgreSQL staging environment with transaction/concurrency UAT.
const phase2 = readFileSync(
  new URL("../../../../docs/recycling/phase2_transaction_schema_draft.sql", import.meta.url), "utf8"
);
const phase3 = readFileSync(
  new URL("../../../../docs/recycling/phase3_finance_gl_bridge_draft.sql", import.meta.url), "utf8"
);

describe("Recycling SQL development drafts (not production migrations)", () => {
  it("keeps a single complete atomic transaction function", () => {
    expect(phase2.match(/create table if not exists public\.recycling_/g)).toHaveLength(4);
    expect(phase2.match(/create or replace function public\.recycling_post_transaction\(/g)).toHaveLength(1);
    expect(phase2.match(/\$fn\$;/g)).toHaveLength(1);
    expect(phase2).toContain("v_line_minor := round(v_price * v_base_quantity * 100)::bigint;");
    expect(phase2).toContain("recycling_price_changed_refresh_cart");
    expect(phase2).toContain("recycling_request_key_reused");
    expect(phase2.indexOf("v_line_minor := round(")).toBeLessThan(phase2.indexOf("if v_line_minor<=0"));
    // Catch the accidental duplicated SQL tail that previously followed
    // the release plan comments and broke PostgreSQL parsing.
    const afterReleasePlan = phase2.slice(phase2.indexOf("-- Release plan:")).trim();
    expect(afterReleasePlan.split("\n").every(line => line.startsWith("--") || line.length === 0)).toBe(true);
  });

  it("isolates tables by tenant and branch, and service-role protects both RPCs", () => {
    for (const table of [
      "recycling_stock_balances","recycling_transactions",
      "recycling_transaction_lines","recycling_accounting_entries"
    ]) {
      expect(phase2).toContain("alter table public." + table + " enable row level security");
      expect(phase2).toContain("revoke all on public." + table + " from anon,authenticated");
    }
    expect(phase2).toContain("revoke all on function public.recycling_post_transaction(");
    expect(phase2).toContain("to service_role;");
    expect(phase3).toContain("revoke all on function public.recycling_finance_post_transaction(");
    expect(phase3).toContain("recycling_finance_self_approval_forbidden");
    expect(phase3).toContain("finance_accounting_check_actor");
  });

  it("records immutable receipt snapshots and double-entry inventory COGS", () => {
    for (const field of [
      "receipt_no", "sku_snapshot", "name_snapshot", "category_snapshot",
      "cogs_minor", "carrying_cost_minor", "recycling_stock_insufficient",
      "recycling_ledger_not_balanced"
    ]) expect(phase2).toContain(field);
    for (const code of ["'1100'","'1110'","'1200'","'1201'","'2100'","'4100'","'5100'"]) {
      expect(phase2).toContain(code);
      expect(phase3).toContain(code);
    }
    expect(phase3).toContain("finance_accounting_journal_lines");
    expect(phase3).toContain("finance_accounting_document_events");
    expect(phase3).toContain("finance_accounting_periods");
    expect(phase3).toContain("v_document_no := v_tx.receipt_no;");
  });
});

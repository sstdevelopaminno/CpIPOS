import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(new URL("../../../../supabase/migrations/" + name, import.meta.url), "utf8");
}
const rls = migration("20261018100000_custom_optical_crm_it_menu_rls.sql");
const report = migration("20261018103000_custom_optical_crm_report_v1.sql");

describe("Optical gated SQL migration release preflight", () => {
  it.each([["CRM RLS", rls], ["owner report", report]])("%s has one transaction and paired PL/pgSQL delimiters", (_name, sql) => {
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect((sql.match(/\\$function\\$/g) ?? []).length % 2).toBe(0);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("restores Postgres dollar-anchored patterns in SECURITY DEFINER product RPC", () => {
    expect(rls).toContain("!~ '^[0-9]+([.][0-9]{1,2})?$'");
    expect(rls).toContain("!~ '^-?[0-9]{1,2}([.][0-9]{1,2})?$'");
    expect(rls).toContain("OPTICAL_CRM_STOCK_IT_DISABLED");
    expect(rls).toContain("OPTICAL_CRM_CUSTOMERS_IT_DISABLED");
    expect(rls).not.toMatch(/end \\$function\\$;/i);
  });
  it("gates CRM reporting and cannot mutate shared finance, stock or products", () => {
    expect(report).toContain("create or replace function public.optical_report_v1");
    expect(report).toContain("security invoker");
    expect(report).toContain("raise exception 'OPTICAL_CRM_REPORT_ACCESS_DENIED'");
    expect(report).toContain("main.crm_optical_reports");
    expect(report).toContain("main.crm_optical_orders");
    expect(report).toContain("public.optical_payment_ledger");
    expect(report).toContain("public.optical_work_orders");
    expect(report).toContain("public.optical_work_order_lines");
    for (const metric of ["payment_received","fulfilled_sales","seller_received","popular_product"]) {
      expect(report).toContain(metric);
    }
    expect(report).not.toMatch(/\\b(insert\\s+into|update\\s+public\\.|delete\\s+from|truncate)\\b/i);
    expect(report).not.toContain("from public.orders");
    expect(report).not.toContain("from public.payments");
    expect(report).toContain("p.currency_code='LAK'");
    expect(report).toContain("o.currency_code='LAK'");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("rolling sales retention archive", () => {
  const migration = src("../../supabase/migrations/20260928190000_sales_retention_archive_pipeline.sql");
  const worker = src("../../supabase/functions/sales-retention-worker/index.ts");

  it("archives only completed/cancelled old sales and excludes tax-invoice orders", () => {
    expect(migration).toContain("o.status in ('completed','cancelled')");
    expect(migration).toContain("public.pos_tax_invoices");
    expect(migration).toContain("tax_invoice_orders_excluded");
  });

  it("never deletes product/catalog master data", () => {
    expect(migration).toContain("products_deleted',false");
    expect(migration).toContain("delete from public.orders");
    expect(migration).not.toContain("delete from public.products");
    expect(migration).not.toContain("delete from public.categories");
    expect(migration).not.toContain("delete from public.inventory");
  });

  it("requires export, email and a seven-day safety window before purge", () => {
    expect(migration).toContain("email_sent_at is not null");
    expect(migration).toContain("purge_after <= now()");
    expect(migration).toContain("'safety_grace_days',7");
    expect(worker).toContain("retention_manifest_missing");
  });

  it("stores customer exports in a private Storage bucket", () => {
    expect(migration).toContain("'sales-retention-exports'");
    expect(migration).toContain("false,");
    expect(worker).toContain("orders.csv");
    expect(worker).toContain("items.csv");
    expect(worker).toContain("payments.csv");
    expect(worker).toContain("manifest.json");
  });

  it("uses one-time worker and email callback tokens", () => {
    expect(migration).toContain("sales_retention_worker_tokens");
    expect(migration).toContain("sales_retention_email_tokens");
    expect(migration).toContain("digest(v_token,'sha256')");
    expect(worker).toContain("consume_sales_retention_worker_token");
    expect(worker).toContain("issue_sales_retention_email_token");
  });

  it("schedules one low-frequency worker invocation per day", () => {
    expect(migration).toContain("cpipos_sales_retention_daily");
    expect(migration).toContain("'35 18 * * *'");
    expect(migration).toContain("app.invoke_sales_retention_worker()");
  });

  it("prevents spreadsheet formula injection in exported text cells", () => {
    expect(worker).toContain('/^[=+\\-@]/');
    expect(worker).toContain(`valueText = "'" + valueText`);
  });
});

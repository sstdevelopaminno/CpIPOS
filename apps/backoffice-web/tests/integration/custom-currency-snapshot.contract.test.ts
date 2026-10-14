import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = file("../../../../supabase/migrations/20261014130000_pos_sales_currency_snapshot.sql");
const receiptApi = file("../../src/app/api/pos/receipts/route.ts");
const currencyApi = file("../../src/app/api/pos/settings/currency/route.ts");

describe("CUSTOM POS THB/LAK financial snapshots", () => {
 it("database trigger snapshots currency for all order creation methods", () => {
  expect(migration).toContain("before insert on public.orders");
  expect(migration).toContain("new.metadata := jsonb_set(");
  expect(migration).toContain("pos_currency_code");
  expect(migration).toContain("currency_code");
 });
 it("preserves historic THB receipts even when shop current currency is LAK", () => {
  expect(receiptApi).toContain('readMetadataString(row.metadata, "currency_code") === "LAK" ? "LAK" : "THB"');
  expect(receiptApi).toContain("const shopCurrencyCode = await getTenantPosCurrencyCode");
 });
 it("routes existing-order cutovers through IT review", () => {
  expect(currencyApi).toContain('"currency_change_requires_migration"');
  expect(currencyApi).toContain("Tenants / Stores");
  expect(currencyApi).toContain('eq("updated_at", ctx.contract.updated_at)');
 });
});

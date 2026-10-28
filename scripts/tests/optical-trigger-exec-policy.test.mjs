import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = process.cwd();
const migration = readFileSync(
  new URL("../../supabase/migrations/20261020202000_restrict_optical_document_trigger_exec.sql", import.meta.url),
  "utf8"
);
const original = readFileSync(
  new URL("../../supabase/migrations/20261020200000_optical_stable_document_numbers_v1.sql", import.meta.url),
  "utf8"
);

test("Optical numbering trigger helper has explicit least-privilege EXECUTE revocation", () => {
  assert.match(migration, /revoke execute on function public\.optical_assign_document_number_after_insert_v1\(\)\s+from public, anon, authenticated\s*;/i);
  assert.match(migration, /grant execute on function public\.optical_assign_document_number_after_insert_v1\(\)\s+to service_role\s*;/i);
  assert.doesNotMatch(migration, /\b(drop table|drop trigger|delete from|truncate)\b/i);
});

test("Original bill/receipt triggers remain declared as independent AFTER INSERT hooks", () => {
  assert.match(original, /create trigger optical_work_order_number_after_insert_v1\s+after insert on public\.optical_work_orders/i);
  assert.match(original, /create trigger optical_payment_number_after_insert_v1\s+after insert on public\.optical_payment_ledger/i);
});

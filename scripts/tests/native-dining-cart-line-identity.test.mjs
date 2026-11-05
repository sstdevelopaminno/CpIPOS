import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20261105080239_native_dining_cart_line_identity_20261105.sql", import.meta.url),
  "utf8"
);

test("Native dine-in line identity is immutable and independent of visible notes", () => {
  assert.match(migration, /group by 1,2,3/i);
  assert.match(migration, /duplicate_native_cart_line_id/i);
  assert.match(migration, /oi\.metadata->'native_selection'->>'cart_line_id'=ti\.native_line_id/i);
  assert.match(migration, /i\.metadata->'native_selection'->>'cart_line_id'=ti\.native_line_id/i);
  assert.match(migration, /ti\.native_line_id is null and not \(coalesce\(oi\.metadata/);
});

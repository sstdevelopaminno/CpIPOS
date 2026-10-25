import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/api/pos/catalog-management/route.ts"),
  "utf8"
);

describe("native catalog product visibility", () => {
  it("filters soft-deleted/inactive products from product list responses", () => {
    const productQuery = source.slice(
      source.indexOf('let query = db.from("products")'),
      source.indexOf('const productsResult = await query;')
    );

    expect(productQuery).toContain('.eq("is_active", true)');
  });
});

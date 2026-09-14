import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(process.cwd(), "../..");
const picker = readFileSync(
  resolve(process.cwd(), "src/components/pos-preview/stock-bundle-picker-pagination.tsx"),
  "utf8",
);
const popupRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/backoffice/bundles/popup/route.ts"),
  "utf8",
);
const salesService = readFileSync(
  resolve(process.cwd(), "src/lib/services/pos-sales-service.ts"),
  "utf8",
);
const androidMain = readFileSync(
  resolve(workspaceRoot, "apps/pos-android/app/src/main/java/com/cpipos/pos/MainActivity.kt"),
  "utf8",
);
const migration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/20260914022721_enforce_bundle_item_integer_quantity.sql"),
  "utf8",
);

describe("bundle integer quantity and shared stock safety contract", () => {
  it("forces bundle component controls to whole numbers with a minimum of one", () => {
    expect(picker).toContain('input.min = "1"');
    expect(picker).toContain('input.step = "1"');
    expect(picker).toContain('input.inputMode = "numeric"');
    expect(picker).toContain("Math.max(1, Math.round(parsed))");
    expect(picker).toContain('[".", ",", "e", "E", "+", "-"]');
    expect(picker).toContain('event.key === "ArrowDown"');
  });

  it("rejects fractional and below-one bundle quantities before product conversion", () => {
    expect(popupRoute).toContain("Number.isInteger(qty)");
    expect(popupRoute).toContain("qty < 1");
    expect(popupRoute).toContain('"invalid_bundle_item_quantity"');
    expect(popupRoute.indexOf("hasInvalidBundleQuantity(body.items)")).toBeLessThan(
      popupRoute.indexOf("const productId"),
    );
  });

  it("enforces the same invariant at the database boundary", () => {
    expect(migration).toContain("product_combo_items_qty_integer_min_one");
    expect(migration).toContain("qty >= 1");
    expect(migration).toContain("qty = trunc(qty)");
  });

  it("keeps POS stock and payment safeguards enabled in the shared backend", () => {
    expect(salesService).toContain('message.includes("INSUFFICIENT_STOCK")');
    expect(salesService).toContain("validateStockBeforeDeduction");
    expect(salesService).toContain("resolveCompletedPaymentReplay");
    expect(salesService).toContain('process.env.POS_SOFT_BYPASS_INSUFFICIENT_STOCK');
    expect(salesService).toContain('process.env.POS_FORCE_DIRECT_CREATE_NON_DELIVERY');
    expect(salesService).toContain('process.env.POS_FORCE_DIRECT_PAYMENT_COMPLETE');
  });

  it("confirms Android POS is a WebView wrapper over the same production web backend", () => {
    expect(androidMain).toContain("POS-WebView-Wrapper");
    expect(androidMain).toContain("webView.loadUrl(BuildConfig.CPIPOS_POS_WEB_URL)");
    expect(androidMain).toContain("BuildConfig.CPIPOS_POS_WEB_URL");
  });
});

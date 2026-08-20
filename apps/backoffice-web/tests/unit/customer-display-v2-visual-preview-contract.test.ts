import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const preview = readFileSync(
  resolve(process.cwd(), "src/components/pos/pos-customer-display-v2-visual-preview.tsx"),
  "utf8"
);
const page = readFileSync(
  resolve(process.cwd(), "src/app/preview/pos/customer-display/v2-preview/page.tsx"),
  "utf8"
);

describe("customer display v2 visual preview contract", () => {
  it("stays isolated from production APIs and database state", () => {
    expect(preview).not.toContain("fetch(");
    expect(preview).not.toContain("/api/pos/customer-display");
    expect(preview).not.toContain("supabase");
    expect(preview).toContain("Mock data only");
  });

  it("covers the review states requested for customer display v2", () => {
    expect(preview).toContain('type PreviewPhase = "idle" | "cart" | "cash" | "qr" | "paid";');
    expect(preview).toContain("รับเงินมา");
    expect(preview).toContain("เงินทอน");
    expect(preview).toContain("QR ชำระเงิน");
    expect(preview).toContain("พื้นที่โฆษณา");
    expect(preview).toContain("minmax(0,58fr) minmax(320px,42fr)");
  });

  it("keeps the preview behind the existing customer display permission", () => {
    expect(page).toContain('requirePosPagePermission("customer_display:manage")');
    expect(page).toContain("PosCustomerDisplayV2VisualPreview");
  });
});

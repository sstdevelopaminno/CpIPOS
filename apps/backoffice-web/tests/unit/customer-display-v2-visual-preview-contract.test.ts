import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const preview = readFileSync(
  resolve(process.cwd(), "src/components/pos/pos-customer-display-v2-visual-preview.tsx"),
  "utf8"
);
const protectedPage = readFileSync(
  resolve(process.cwd(), "src/app/preview/pos/customer-display/v2-preview/page.tsx"),
  "utf8"
);
const publicReviewPage = readFileSync(
  resolve(process.cwd(), "src/app/visual-review/customer-display-v2/page.tsx"),
  "utf8"
);
const autoReview = readFileSync(
  resolve(process.cwd(), "src/components/pos/pos-customer-display-v2-auto-review.tsx"),
  "utf8"
);
const liveScreen = readFileSync(
  resolve(process.cwd(), "src/components/pos/pos-customer-display-v2-screen.tsx"),
  "utf8"
);

describe("customer display v2 visual preview contract", () => {
  it("keeps the original visual component isolated from production APIs and database state", () => {
    expect(preview).not.toContain("fetch(");
    expect(preview).not.toContain("/api/pos/customer-display");
    expect(preview).not.toContain("supabase");
  });

  it("runs the original review flow automatically and preserves the five-minute live idle contract", () => {
    expect(preview).toContain('type PreviewPhase = "idle" | "cart" | "cash" | "qr" | "paid";');
    expect(preview).toContain("const LIVE_IDLE_TIMEOUT_MS = 5 * 60_000;");
    expect(preview).toContain("const AUTO_DEMO_SEQUENCE");
    expect(preview).toContain('{ phase: "idle"');
    expect(preview).toContain('{ phase: "cart"');
    expect(preview).toContain('{ phase: "cash"');
    expect(preview).toContain('{ phase: "qr"');
    expect(preview).toContain('{ phase: "paid"');
    expect(preview).not.toContain("<button");
  });

  it("removes visual-review-only customer-facing labels requested in review", () => {
    expect(preview).not.toContain("ยินดีต้อนรับ");
    expect(preview).not.toContain("เมื่อไม่มีรายการขาย");
    expect(preview).not.toContain("LOGO STORE");
    expect(preview).not.toContain("พื้นที่โฆษณา");
    expect(preview).not.toContain("โปรโมชั่นพิเศษประจำเดือน");
    expect(preview).not.toContain("Layout 58%");
    expect(preview).not.toContain("สแกนเพื่อชำระเงิน");
    expect(preview).not.toContain("QR ในหน้านี้เป็นภาพจำลอง");
  });

  it("keeps cash received and change on the bill side without the duplicate paid-side change card", () => {
    expect(preview).toContain("รับเงินมา");
    expect(preview).toContain("เงินทอน");
    expect(preview).toContain("showCash");
    expect(preview).not.toContain("cdv2-paid-change");
  });

  it("uses full-screen responsive layout instead of the visual-review toolbar", () => {
    expect(preview).toContain("width: 100vw;");
    expect(preview).toContain("height: 100dvh;");
    expect(preview).toContain("@media (max-width: 900px)");
    expect(preview).toContain("@media (max-width: 620px)");
  });

  it("keeps the existing POS preview protected", () => {
    expect(protectedPage).toContain('requirePosPagePermission("customer_display:manage")');
    expect(protectedPage).toContain("PosCustomerDisplayV2VisualPreview");
  });

  it("provides a public mock-only review that exercises the same transparent live renderer", () => {
    expect(publicReviewPage).toContain("CustomerDisplayV2PublicVisualReviewPage");
    expect(publicReviewPage).toContain('<PosCustomerDisplayV2AutoReview lang="th" />');
    expect(publicReviewPage).not.toContain("requirePosPagePermission");
    expect(publicReviewPage).not.toContain("fetch(");
    expect(publicReviewPage).not.toContain("supabase");
    expect(autoReview).toContain("PosCustomerDisplayV2Screen");
    expect(autoReview).not.toContain("fetch(");
    expect(liveScreen).toContain('/brand/cpipos-symbol-transparent.png');
  });
});

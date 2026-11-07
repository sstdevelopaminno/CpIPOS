import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const claimRoute = read("../../src/app/api/print-agent/v1/jobs/claim/route.ts");
const windowsClient = read("../../src/lib/printing/windows-local-printer-test.ts");
const receiptTemplate = read("../../src/lib/printing/receipt-html-template.ts");

describe("canonical receipt rich print contract", () => {
  it("never downgrades canonical receipt HTML to fast text mode", () => {
    expect(claimRoute).toContain("isCanonicalRichHtmlDocument");
    expect(claimRoute).toContain('payloadFormat.includes("receipt_html")');
    expect(claimRoute).toContain("if (isCanonicalRichHtmlDocument(metadata, html)) return false");
  });

  it("sends the actual canonical HTML to the Windows native bridge", () => {
    expect(windowsClient).toContain("html: printableHtml");
    expect(windowsClient).toContain("const printableHtml = appOrigin");
    expect(windowsClient).toContain('payload.data?.provider !== "native_winforms_html_receipt"');
    expect(windowsClient).toContain('payload_format: "receipt_html_v1"');
  });

  it("retains the canonical receipt visual structure", () => {
    expect(receiptTemplate).toContain('class="logo-wrap"');
    expect(receiptTemplate).toContain('class="meta-line"');
    expect(receiptTemplate).toContain('class="summary-line grand"');
    expect(receiptTemplate).toContain('L("ยอดสุทธิ","Net total","ຍອດສຸດທິ")');
  });
});

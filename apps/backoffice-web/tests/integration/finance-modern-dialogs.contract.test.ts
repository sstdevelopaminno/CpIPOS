import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const dialog = read("src/components/finance/finance-dialog.tsx");
const document = read("src/components/finance/finance-document-workspace.tsx");
const menu = read("src/app/finance/[module]/page.tsx");

describe("Finance standardized form and confirmation dialogs", () => {
  it("uses accessible native modal semantics and supports backdrop, Escape and explicit Close", () => {
    expect(dialog).toContain("<dialog");
    expect(dialog).toContain("dialog.showModal()");
    expect(dialog).toContain("dialog.close()");
    expect(dialog).toContain('aria-labelledby={titleId}');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('event.target === event.currentTarget');
    expect(dialog).toContain('onCancel={(event) => { event.preventDefault(); dismiss(); }}');
    expect(dialog).toContain('aria-label="ปิดหน้าต่าง"');
    expect(dialog).toContain('if (!busy) onClose()');
    expect(dialog).toContain('disabled={busy || confirmDisabled}');
  });

  it("replaces browser-native confirmations and inline buyer panels on Finance documents", () => {
    expect(document).not.toMatch(/\b(window\.)?(confirm|alert)\s*\(/);
    expect(document).not.toContain("<details");
    expect(document).toContain('<FinanceDialog open={buyerModalOpen}');
    expect(document).toContain('<FinanceDialog open={Boolean(edit)}');
    expect(document).toContain('<FinanceConfirmDialog open={issueDialogOpen}');
    expect(document).toContain('<FinanceConfirmDialog open={voidDialogOpen}');
    expect(document).toContain('title="ยืนยันออกใบกำกับภาษี"');
    expect(document).toContain('title="ยืนยันยกเลิกใบเสร็จ"');
    expect(document).toContain('setBuyerModalOpen(true)');
    expect(document).toContain('setIssueDialogOpen(true)');
    expect(document).toContain('setVoidDialogOpen(true)');
  });

  it("closes dialogs only after a confirmed API save; errors remain visible without discarding form input", () => {
    const successCheck = document.indexOf('if (!response.ok) throw new Error(');
    const closed = document.indexOf('setBuyerModalOpen(false);', successCheck);
    const failed = document.indexOf('} catch (cause) {', closed);
    expect(successCheck).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(successCheck);
    expect(failed).toBeGreaterThan(closed);
    expect(document).toContain('setBuyerRefresh(n => n + 1)');
    expect(document).toContain('setBuyerId(id)');
    expect(document).toContain('setIssueDialogOpen(false)');
    expect(document).toContain('setVoidDialogOpen(false)');
    expect(document).toContain('setEdit(null)');
    expect(document).toContain('setError(errorMessages[code]');
    expect(document).toContain('role="alert"');
    expect(document).toContain('setNotice(successText)');
    expect(document).not.toContain('setLoading(true); setError(""); setNotice("");');
  });

  it("retains existing Finance authorization, VAT, receipt-history and audited correction services", () => {
    expect(menu).toContain('requireAccountantPage(item.key)');
    expect(menu).toContain('<FinanceDocumentWorkspace kind="tax" />');
    expect(menu).toContain('<FinanceDocumentWorkspace kind="receipt" />');
    expect(document).toContain('action: "create_buyer"');
    expect(document).toContain('action: "issue_tax"');
    expect(document).toContain('action: "correct"');
    expect(document).toContain('action: "void"');
    expect(document).toContain('expectedRevision: receipt.revision');
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readEnv: vi.fn(),
  enqueuePrintJob: vi.fn(),
  processPrintJob: vi.fn(),
  resolvePrinterRoutes: vi.fn(),
  loadReceiptStoreProfile: vi.fn(),
  renderReceiptHtml: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
  loadTaxSettings: vi.fn()
}));

vi.mock("@/lib/env", () => ({ readEnv: mocks.readEnv }));
vi.mock("@/lib/printing/print-service", () => ({
  enqueuePrintJob: mocks.enqueuePrintJob,
  processPrintJob: mocks.processPrintJob
}));
vi.mock("@/lib/printing/printer-routing-service", () => ({
  resolvePrinterRoutes: mocks.resolvePrinterRoutes
}));
vi.mock("@/lib/services/store-profile-service", () => ({
  loadReceiptStoreProfile: mocks.loadReceiptStoreProfile
}));
vi.mock("@/lib/printing/receipt-html-template", () => ({
  renderReceiptHtml: mocks.renderReceiptHtml
}));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient
}));
vi.mock("@/lib/services/pos-settings-service", () => ({
  loadTaxSettings: mocks.loadTaxSettings
}));

import { queueRoutedRecyclingReceipt } from "@/lib/printing/recycling-receipt-print-service";

const postedAt = "2026-11-24T00:00:00.000Z";

function databaseFixture() {
  const from = vi.fn((table: string) => {
    if (table === "print_jobs") throw new Error("unexpected duplicate print job preflight SELECT");
    const row = table === "recycling_transactions"
      ? { id: "tx-1", receipt_no: "REC-001", direction: "buy", settlement: "cash",
          counterparty_name: "Supplier", total_minor: 10000, base_minor: 10000,
          vat_minor: 0, tax_state: "none", status: "posted", void_reason: null,
          created_at: postedAt }
      : table === "tenants" ? { name: "Test store", display_name: null }
      : table === "branches" ? { name: "Branch name" } : null;
    const query = {
      eq() { return query; },
      maybeSingle: async () => ({ data: row, error: null }),
      order: async () => ({
        data: [{ line_no: 1, sku_snapshot: "M1", name_snapshot: "Material", original_quantity: 1,
          original_unit: "kg", base_unit: "kg", price_per_base: 100, amount_minor: 10000 }],
        error: null
      })
    };
    return { select: () => query };
  });
  mocks.getSupabaseServiceClient.mockReturnValue({ from });
  return { from };
}

function auth(tenantId: string, branchId: string) {
  return {
    userId: "cashier-1",
    platformRole: "tenant_user" as const,
    tenantId,
    branchId,
    branchRole: "manager" as const
  };
}

describe("recycling print fast enqueue in multi-owner and multi-branch mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readEnv.mockImplementation((key: string) => key === "VERCEL" ? "1" : undefined);
    mocks.loadReceiptStoreProfile.mockResolvedValue({ company_address: null, contact_phone: null, logo_url: null });
    mocks.loadTaxSettings.mockResolvedValue(null);
    mocks.renderReceiptHtml.mockReturnValue("<html>same-thermal-receipt</html>");
    mocks.resolvePrinterRoutes.mockImplementation(({ auth: scoped }) => ([{
      printer: {
        id: `printer-${scoped.tenantId}-${scoped.branchId}`,
        tenant_id: scoped.tenantId,
        branch_id: scoped.branchId,
        printer_role: "receipt",
        connection_type: "NETWORK_ESC_POS",
        paper_width_mm: 80,
        metadata: { print_mode: "agent" }
      },
      copies: 3,
      source: "assignment",
      purpose: "receipt",
      printerDeviceId: "device-1"
    }]));
    const jobs = new Map<string, object>();
    mocks.enqueuePrintJob.mockImplementation(async (input) => {
      const key = [input.auth.tenantId, input.auth.branchId, input.idempotencyKey].join("/");
      if (!jobs.has(key)) jobs.set(key, {
        id: `job-${jobs.size + 1}`, status: "pending", printer_id: input.printer.id,
        printed_at: null, last_error: null
      });
      return jobs.get(key);
    });
    databaseFixture();
  });

  it("renders one HTML per assigned printer, not one per paper copy", async () => {
    const result = await queueRoutedRecyclingReceipt({
      auth: auth("owner-A", "branch-A"),
      transactionId: "tx-1", requestId: "request-1"
    });
    expect(result).toHaveLength(3);
    expect(new Set(result.map((row) => row.id)).size).toBe(3);
    expect(mocks.renderReceiptHtml).toHaveBeenCalledTimes(1);
    expect(mocks.enqueuePrintJob).toHaveBeenCalledTimes(3);
    expect(mocks.processPrintJob).not.toHaveBeenCalled();
    expect(mocks.getSupabaseServiceClient().from).toHaveBeenCalledTimes(4);
  });

  it("rejects a receipt outside the authenticated tenant and branch before enqueue", async () => {
    const filters: Array<[string,string]> = [];
    const original = mocks.getSupabaseServiceClient().from;
    const query = {
      eq(column:string, value:string) { filters.push([column,value]); return query; },
      maybeSingle: async () => ({ data: null, error: null })
    };
    mocks.getSupabaseServiceClient.mockReturnValue({
      from: (table:string) => table === "recycling_transactions" ? { select: () => query } : original(table)
    });
    await expect(queueRoutedRecyclingReceipt({
      auth: auth("owner-A", "branch-A"),
      transactionId: "foreign-receipt", requestId: "request-1"
    })).rejects.toThrow("recycling_receipt_not_found");
    expect(filters).toEqual([["id","foreign-receipt"],["tenant_id","owner-A"],["branch_id","branch-A"]]);
    expect(mocks.enqueuePrintJob).not.toHaveBeenCalled();
  });

  it("isolates concurrent receipts between two owners and two branches", async () => {
    const scopes = [
      ["owner-A", "branch-1"], ["owner-A", "branch-2"],
      ["owner-B", "branch-1"], ["owner-B", "branch-2"]
    ] as const;
    const results = await Promise.all(scopes.flatMap(([owner, branch]) =>
      Array.from({ length: 5 }, () => queueRoutedRecyclingReceipt({
        auth: auth(owner, branch), transactionId: "tx-1", requestId: "request-1"
      }))
    ));
    expect(results).toHaveLength(20);
    expect(results.every((jobSet) => jobSet.length === 3)).toBe(true);
    expect(mocks.renderReceiptHtml).toHaveBeenCalledTimes(20);
    const enqueued = mocks.enqueuePrintJob.mock.calls.map(([input]) => input);
    expect(enqueued).toHaveLength(60);
    expect(enqueued.every((input) => input.printer.tenant_id === input.auth.tenantId &&
      input.printer.branch_id === input.auth.branchId)).toBe(true);
    for (let i = 0; i < scopes.length; i += 1) {
      const scopeResults = results.slice(i * 5, i * 5 + 5).flat();
      expect(new Set(scopeResults.map((job) => job.id)).size).toBe(3);
    }
  });
});

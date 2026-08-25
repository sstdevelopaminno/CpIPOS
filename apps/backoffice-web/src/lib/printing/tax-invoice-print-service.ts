import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { readEnv } from "@/lib/env";
import { enqueuePrintJob, processPrintJob } from "@/lib/printing/print-service";
import { resolvePrinterRoutes, type ResolvedPrinterRoute } from "@/lib/printing/printer-routing-service";
import {
  buildTaxInvoicePrintHtml,
  type TaxBuyerSnapshot,
  type TaxInvoiceItemSnapshot,
  type TaxInvoiceOrderSnapshot,
  type TaxInvoiceTaxSnapshot,
  type TaxSellerSnapshot
} from "@/lib/pos-tax-invoice";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readStringArray(value: unknown) {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function routeUsesAgent(route: ResolvedPrinterRoute) {
  const metadata = asRecord(route.printer.metadata);
  return (
    readStringArray(metadata.agent_device_code ?? metadata.agent_device_codes ?? metadata.device_code ?? metadata.device_codes).length > 0 ||
    readStringArray(metadata.assigned_agent_id ?? metadata.assigned_agent_ids ?? metadata.agent_id ?? metadata.agent_ids).length > 0 ||
    metadata.print_mode === "agent" ||
    metadata.processing_mode === "print_agent" ||
    metadata.queue_only === true
  );
}

function shouldDefer(route: ResolvedPrinterRoute) {
  const metadata = asRecord(route.printer.metadata);
  if (metadata.server_direct_print === true || metadata.process_on_server === true || metadata.print_mode === "server") return false;
  if (routeUsesAgent(route)) return true;
  return readEnv("VERCEL") === "1" || Boolean(readEnv("VERCEL_ENV"));
}

export async function queueRoutedTaxInvoice(args: {
  auth: AuthContext;
  runtimeDeviceCode?: string | null;
  invoiceId: string;
  invoiceNo: string;
  issuedAt: string;
  orderId: string;
  seller: TaxSellerSnapshot;
  buyer: TaxBuyerSnapshot;
  order: TaxInvoiceOrderSnapshot;
  items: TaxInvoiceItemSnapshot[];
  tax: TaxInvoiceTaxSnapshot;
}) {
  const routes = await resolvePrinterRoutes({
    auth: args.auth,
    purpose: "reprint",
    fallbackPurposes: ["receipt"],
    runtimeDeviceCode: args.runtimeDeviceCode,
    legacyRole: "receipt"
  });
  if (routes.length === 0) throw new Error("receipt_printer_not_configured");

  const jobs = [];
  for (const route of routes) {
    const paperWidthMm = route.printer.paper_width_mm === 80 ? 80 : 58;
    const html = buildTaxInvoicePrintHtml({
      invoiceNo: args.invoiceNo,
      issuedAt: args.issuedAt,
      paperWidthMm,
      seller: args.seller,
      buyer: args.buyer,
      order: args.order,
      items: args.items,
      tax: args.tax
    });
    const job = await enqueuePrintJob({
      auth: args.auth,
      printer: route.printer,
      orderId: args.orderId,
      kitchenTicketId: null,
      idempotencyKey: null,
      printerRole: "receipt",
      payloadText: `TAX INVOICE\n${args.invoiceNo}\nBILL ${args.order.order_no}\n${args.order.grand_total.toFixed(2)}`,
      payloadJson: {
        document_type: "tax_invoice",
        invoice_id: args.invoiceId,
        invoice_no: args.invoiceNo,
        order_id: args.orderId,
        order_no: args.order.order_no,
        buyer: args.buyer,
        seller: args.seller,
        tax: args.tax,
        total_amount: args.order.grand_total
      },
      metadata: {
        request_source: "pos_tax_invoice",
        document_type: "tax_invoice",
        invoice_id: args.invoiceId,
        invoice_no: args.invoiceNo,
        paper_width_mm: paperWidthMm,
        payload_format: "tax_invoice_html_v1",
        payload_html: html,
        routing_source: route.source,
        routing_purpose: route.purpose,
        routing_zone_key: route.zoneKey || null,
        routing_printer_device_id: route.printerDeviceId,
        routing_runtime_device_code: route.runtimeDeviceCode
      }
    });
    jobs.push(shouldDefer(route) ? job : (await processPrintJob(job.id)) ?? job);
  }
  return { mode: "routed_tax_invoice" as const, jobs };
}

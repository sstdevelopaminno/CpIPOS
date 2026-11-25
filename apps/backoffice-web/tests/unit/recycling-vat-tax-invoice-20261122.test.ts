import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
import {
  recyclingVatMinor,renderRecyclingTaxInvoiceHtml,
  type RecyclingInvoiceSnapshot
} from "@/lib/recycling-tax-invoice";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const vatSchema=read("../../supabase/migrations/20261122103100_recycling_vat_schema_v1.sql");
const vatPosting=read("../../supabase/migrations/20261122103126_recycling_vat_posting_finance_v1.sql");
const vatIssue=read("../../supabase/migrations/20261122103138_recycling_tax_invoice_issue_v1.sql");
const postApi=read("src/app/api/pos/recycling/transactions/route.ts");
const invoiceApi=read("src/app/api/pos/recycling/tax-invoices/route.ts");
const invoicePreview=read("src/app/api/pos/recycling/tax-invoices/[id]/preview/route.ts");
const receiptPrint=read("src/lib/printing/recycling-receipt-print-service.ts");
const receiptPreview=read("src/app/api/pos/recycling/receipts/[id]/preview/route.ts");
const cashier=read("src/components/pos/recycling-pos-workspace.tsx");
const ui=read("src/components/pos/recycling-tax-invoice-action.tsx");

const example:RecyclingInvoiceSnapshot={
  id:"invoice-1",invoice_no:"RTI-000001",issued_at:"2026-11-22T04:00:00Z",
  seller_snapshot:{
    display_name:"Synthetic VAT seller",tax_id:"0105555555555",
    address:"1 Example Road",branch_no:"00000"
  },
  buyer_snapshot:{
    display_name:"Synthetic VAT buyer",tax_id:"0105555555555",branch_no:"00000",
    address_line:"2 Example Road",subdistrict:"Example",district:"District",
    province:"Province",postal_code:"10000"
  },
  items_snapshot:[{
    name:"Iron",sku:"IRON-1",quantity:10,unit:"kg",price_per_base:10,base_minor:10000
  }],
  tax_snapshot:{
    receipt_no:"RCY-000001",sale_at:"2026-11-22T04:00:00Z",
    base_minor:10000,vat_minor:700,total_minor:10700,
    rate_pct:7,mode:"add_to_bill"
  }
};

describe("Recycling genuine VAT invoice (isolated UAT contract)",()=>{
  it("uses satang rounding only for preview, server RPC remains authority",()=>{
    expect(recyclingVatMinor(10000)).toBe(700);
    expect(recyclingVatMinor(101)).toBe(7);
    expect(recyclingVatMinor(1)).toBe(0);
    expect(()=>recyclingVatMinor(Number.NaN)).toThrow("recycling_vat_invalid_amount");
    expect(postApi).toContain('db.rpc("recycling_post_transaction_vat",');
    expect(postApi).not.toContain('RECYCLING_VAT_WRITES_ENABLED');
    expect(postApi).not.toContain('db.rpc("recycling_post_transaction",');
    expect(vatPosting).toContain('v_vat_minor := round(v_base_minor::numeric * v_vat_rate / 100)::bigint;');
    expect(vatPosting).toContain("'2200','ภาษีขายรอนำส่ง',v_vat_minor");
  });
  it("renders four papers from exact persisted base/VAT/gross and escapes names",()=>{
    for(const p of ["58","80","a4","a5"] as const){
      const html=renderRecyclingTaxInvoiceHtml(example,p);
      expect(html).toContain("RTI-000001");
      expect(html).toContain("100.00");
      expect(html).toContain("7.00");
      expect(html).toContain("107.00");
      expect(html).toContain("ใบกำกับภาษี");
    }
    const html=renderRecyclingTaxInvoiceHtml({
      ...example,buyer_snapshot:{...example.buyer_snapshot,display_name:'<img src=x onerror="alert(1)">' }
    },"80");
    expect(html).not.toContain('<img src=x onerror=');
    expect(html).toContain("&lt;img");
    expect(()=>renderRecyclingTaxInvoiceHtml({
      ...example,tax_snapshot:{...example.tax_snapshot,vat_minor:0}
    },"a4")).toThrow("recycling_tax_invoice_snapshot_incomplete");
    expect(()=>renderRecyclingTaxInvoiceHtml({
      ...example,tax_snapshot:{...example.tax_snapshot,total_minor:10800}
    },"a5")).toThrow();
  });
  it("requires verified issuer and accountant chart; preserves legacy NULL snapshots",()=>{
    expect(vatSchema).toContain('verified_from date not null');
    expect(vatSchema).toContain("active boolean not null default false");
    expect(vatSchema).toContain("base_minor is null and vat_minor is null");
    expect(vatSchema).toContain("request_snapshot->>'source'='recycling'");
    expect(vatPosting).toContain("recycling_vat_registration_not_verified");
    expect(vatPosting).toContain("recycling_vat_account_not_ready");
    expect(vatPosting).toContain("v_base_minor+v_vat_minor");
    expect(vatPosting).toContain("v_amount <> coalesce(v_tx.base_minor,v_tx.total_minor)");
    expect(vatPosting).toContain("v_tx.total_minor,coalesce(v_tx.vat_minor,0),'issued'");
    expect(vatPosting).not.toContain("update public.recycling_transactions set vat_minor=7");
  });
  it("only issues from same-branch persisted sale with manager PIN and idempotent number",()=>{
    expect(invoiceApi).toContain('RECYCLING_TAX_INVOICES_ENABLED!=="1"');
    expect(invoiceApi).toContain('validateManagerPin("sales_record_edit"');
    expect(invoiceApi).toContain('db.rpc("recycling_issue_tax_invoice"');
    expect(vatIssue).toContain('v_tx.direction<>\'sell\'');
    expect(vatIssue).toContain("v_tx.tax_state is distinct from 'vat_recorded'");
    expect(vatIssue).toContain("v_existing.profile_id<>p_profile_id");
    expect(vatIssue).toContain("recycling_tax_invoice_already_issued_to_other_buyer");
    expect(vatIssue).toContain("recycling_tax_issuer_role_denied");
    expect(vatIssue).toContain("recycling_tax_buyer_branch_required");
    expect(vatIssue).toContain("v_no:='RTI-'||lpad(v_seq::text,6,'0')");
    expect(vatSchema).toContain("recycling_tax_invoice_requires_credit_note_before_void");
  });
  it("keeps receipt printing distinct from an invoice but includes saved VAT",()=>{
    expect(receiptPrint).toContain('taxAmount:vat/100');
    expect(receiptPrint).toContain('totalLines!==base');
    expect(receiptPrint).toContain('base+vat!==Number(tx.data.total_minor)');
    expect(receiptPrint).toContain('baseMinor:base,vatMinor:vat,taxState:tx.data.tax_state');
    expect(receiptPreview).toContain('base+vat!==storedTotal');
    expect(receiptPreview).toContain('baseMinor:base,vatMinor:vat,taxState:tx.data.tax_state');
    expect(receiptPrint).toContain('ไม่ใช่ใบกำกับภาษี');
    expect(invoicePreview).toContain('renderRecyclingTaxInvoiceHtml');
    expect(ui).toContain('data-testid="recycling-tax-invoice-print"');
    expect(cashier).toContain("saleVatReady");
  });
});

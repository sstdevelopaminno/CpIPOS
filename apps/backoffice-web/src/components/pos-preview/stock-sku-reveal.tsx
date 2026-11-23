"use client";

import { useMemo, useState } from "react";
import { opticalCode128Svg } from "@/lib/optical/optical-code128-barcode";

function safeText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
}

export function StockSkuReveal({ sku, th, name = "" }: { sku: string | null; th: boolean; name?: string }) {
  const code = String(sku ?? "").trim();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const svg = useMemo(() => {
    try { return code ? opticalCode128Svg(code) : ""; } catch { return ""; }
  }, [code]);

  if (!code) return <span className="text-sm font-semibold text-slate-400">-</span>;

  const printBarcode = () => {
    if (!svg) return;
    const win = window.open("", "_blank", "width=480,height=460");
    if (!win) { setNotice(th ? "กรุณาอนุญาตหน้าต่างสำหรับพิมพ์บาร์โค้ด" : "Allow the print pop-up."); return; }
    win.opener = null;
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Barcode ${safeText(code)}</title>
      <style>@page{size:70mm 40mm;margin:3mm}body{margin:0;text-align:center;font-family:Arial,sans-serif;color:#000}
      h1{font-size:11px;margin:4px 0 6px;overflow-wrap:anywhere}
      svg{display:block;width:100%;height:23mm;max-width:100%}
      p{margin:3px 0;font-size:11px;font-weight:bold;letter-spacing:1px}
      @media print{button{display:none}}</style></head><body><h1>${safeText(name)}</h1>
      ${svg}<p>${safeText(code)}</p><button onclick="window.print()">Print</button></body></html>`);
    win.document.close();
    win.focus();
  };
  return (
    <>
      <button type="button" onClick={() => { setNotice(""); setOpen(true); }}
        className="inline-flex min-h-8 min-w-[72px] items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 font-mono text-sm font-extrabold text-blue-800 hover:bg-blue-100"
        aria-label={th ? `เปิดบาร์โค้ดสินค้า ${code}` : `Open product barcode ${code}`} title={th ? "ดู/พิมพ์บาร์โค้ด" : "View/print barcode"}>
        <span aria-hidden="true">▥</span><span>{code}</span>
      </button>
      {open ? <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 p-4" role="presentation" onClick={() => setOpen(false)}>
        <div role="dialog" aria-modal="true" aria-label={th ? "บาร์โค้ดสินค้า" : "Product barcode"}
          className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between gap-3"><h3 className="font-bold text-slate-900">{th ? "บาร์โค้ดสินค้า" : "Product Barcode"}</h3>
            <button type="button" onClick={() => setOpen(false)} aria-label={th ? "ปิด" : "Close"} className="rounded-lg border px-3 py-1">×</button></div>
          <p className="my-3 text-center text-sm font-bold text-slate-700">{name}</p>
          {svg ? <div className="mx-auto w-full overflow-x-auto rounded-lg border border-slate-200 p-3">
            <div className="mx-auto max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          </div> : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{th ? "รหัสเก่าไม่รองรับรูปแบบ Code128 กรุณาแก้ไข SKU" : "Legacy code cannot be rendered as Code128. Edit the SKU."}</p>}
          <p className="mt-3 text-center font-mono text-lg font-extrabold tracking-widest">{code}</p>
          {notice ? <p role="status" className="my-2 text-xs text-amber-800">{notice}</p> : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => { void navigator.clipboard.writeText(code).then(() => setNotice(th ? "คัดลอกรหัสแล้ว" : "Copied")).catch(() => setNotice(th ? "คัดลอกไม่สำเร็จ" : "Copy failed")); }}
              className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-bold">{th ? "คัดลอก" : "Copy"}</button>
            <button type="button" disabled={!svg} onClick={printBarcode}
              className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">{th ? "พิมพ์บาร์โค้ด" : "Print Barcode"}</button>
          </div>
        </div></div> : null}
    </>
  );
}

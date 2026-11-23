import { opticalCode128Svg } from "@/lib/optical/optical-code128-barcode";

export type RecyclingBarcodeLabelSize = "small" | "medium" | "large" | "full";
export const RECYCLING_BARCODE_LABEL_SIZES: readonly RecyclingBarcodeLabelSize[] = [
  "small", "medium", "large", "full"
];

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Code128 quiet zones are INCLUDED in viewBox width. Never shrink
 * a printed bar module below 0.20mm or extend beyond the conservative thermal
 * driver's 58/80mm printable area (44/64mm respectively).
 */
export function recyclingBarcodePrintDimensions(
  sku: string, paper: 58 | 80, size: RecyclingBarcodeLabelSize = "small"
) {
  const svg = opticalCode128Svg(sku);
  const match = svg.match(/viewBox="0 0 (\d+) 65"/);
  const modules = Number(match?.[1] ?? 0);
  const availableMm = paper === 58 ? 44 : 64;
  if (!modules || modules * 0.20 > availableMm) {
    throw new Error("recycling_barcode_too_wide_for_paper");
  }
  const scaleMm = size === "small" ? 0.20
    : size === "medium" ? 0.28
    : size === "large" ? 0.36
    : availableMm / modules;
  const widthMm = Math.min(availableMm, modules * scaleMm);
  return { svg, modules, widthMm, heightMm: (65 * widthMm) / modules };
}

/** Prints a non-transactional label, independently of any stock changes. */
export function renderRecyclingBarcodeLabel(input: {
  sku: string; name: string; branchName: string; paper: 58 | 80;
  size?: RecyclingBarcodeLabelSize; centerOnPaper?: boolean; thermalOffsetMm?: number;
}): string {
  const { svg, widthMm } = recyclingBarcodePrintDimensions(
    input.sku, input.paper, input.size ?? "small"
  );
  const availableMm = input.paper === 58 ? 44 : 64;
  const contentWidthMm = input.centerOnPaper ? availableMm : input.paper;
  const calibrationMm=Number.isFinite(input.thermalOffsetMm)
    ? Math.max(-6,Math.min(6,Number(input.thermalOffsetMm))):0;
  const leftMargin = input.centerOnPaper
    ? Math.max(0,(input.paper-availableMm)/2+calibrationMm) : 0;
  return '<!doctype html><html lang="th"><head><meta charset="utf-8"/><title>ฉลากบาร์โค้ดวัสดุ</title>'
    + '<style>@page{size:' + input.paper + 'mm auto;margin:0}'
    + 'html,body{margin:0;padding:0;width:' + input.paper + 'mm;background:white;color:black}'
    + 'main{box-sizing:border-box;width:' + contentWidthMm + 'mm;margin-left:' + leftMargin
    + 'mm;padding:2mm 0 2mm;text-align:center;font:11px/1.3 Tahoma,"Noto Sans Thai",sans-serif}'
    + 'h1{font-size:14px;margin:0 0 1.5mm;overflow-wrap:anywhere}'
    + '.code{display:block;width:' + widthMm.toFixed(2) + 'mm;max-width:100%;height:auto;margin:1.5mm auto 1mm}'
    + '.code svg{display:block;width:100%;height:auto}'
    + '.sku{font:13px/1.3 monospace;overflow-wrap:anywhere}'
    + '.sub{font-size:10px;margin-top:1.5mm}</style></head><body>'
    + '<main><h1>' + esc(input.name) + '</h1><div class="code">' + svg
    + '</div><div class="sku">' + esc(input.sku) + '</div>'
    + '<div class="sub">' + esc(input.branchName) + '</div><div class="sub">CUSTOM Recycling · ไม่ใช่ใบเสร็จหรือใบกำกับภาษี</div>'
    + '</main></body></html>';
}

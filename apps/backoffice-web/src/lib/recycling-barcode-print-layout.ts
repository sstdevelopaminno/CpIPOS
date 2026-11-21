import { opticalCode128Svg } from "@/lib/optical/optical-code128-barcode";

function esc(value:string){return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
/** Prints a non-transactional label. Do not silently shrink below 0.20mm/module. */
export function renderRecyclingBarcodeLabel(input:{
 sku:string;name:string;branchName:string;paper:58|80
}):string{
 const svg=opticalCode128Svg(input.sku);
 const match=svg.match(/viewBox="0 0 (\d+) 65"/);
 const modules=Number(match?.[1]??0);
 const available=input.paper===58?48:70;
 if(!modules || modules*0.20>available)throw new Error("recycling_barcode_too_wide_for_paper");
 const width=modules*0.20;
 return '<!doctype html><html lang="th"><head><meta charset="utf-8"/><title>ฉลากบาร์โค้ดวัสดุ</title>'
  +'<style>@page{size:'+input.paper+'mm auto;margin:0}html,body{margin:0;padding:0;width:'+input.paper+'mm;background:white;color:black}'
  +'main{box-sizing:border-box;width:'+input.paper+'mm;padding:3mm 2mm;text-align:center;font:10px/1.3 Tahoma,"Noto Sans Thai",sans-serif}'
  +'h1{font-size:12px;margin:0 0 2mm;overflow-wrap:anywhere}.code{display:block;width:'+width.toFixed(2)+'mm;max-width:100%;height:auto;margin:2mm auto 1mm}'
  +'.code svg{display:block;width:100%;height:auto}.sku{font:12px/1.3 monospace;overflow-wrap:anywhere}.sub{font-size:9px;margin-top:2mm}</style></head><body>'
  +'<main><h1>'+esc(input.name)+'</h1><div class="code">'+svg+'</div><div class="sku">'+esc(input.sku)+'</div>'
  +'<div class="sub">'+esc(input.branchName)+'</div><div class="sub">CUSTOM Recycling · ไม่ใช่ใบเสร็จหรือใบกำกับภาษี</div></main></body></html>';
}

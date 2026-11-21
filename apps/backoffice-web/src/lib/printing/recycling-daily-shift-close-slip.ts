/** Closed-shift report for CUSTOM Recycling only. No fabricated VAT/invoice totals. */
export type RecyclingDailyShiftReport = {
 id:string;branchName:string;openedAt:string|null;closedAt:string|null;
 openingCash:number|null;expectedCash:number|null;actualCash:number|null;
 metadata:Record<string,unknown>;
};
const fmt=(v:number)=>new Intl.NumberFormat("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const minor=(v:unknown)=>{
 if(v===null||v===undefined)return "รอตรวจสอบ";
 const n=Number(v);return Number.isSafeInteger(n)?fmt(n/100):"รอตรวจสอบ";
};
const count=(v:unknown)=>Number.isSafeInteger(Number(v))?String(Number(v)):"0";
const dt=(v:string|null)=>v?new Date(v).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}):"—";
const safe=(v:string)=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
export function recyclingDailyShiftCloseText(shift:RecyclingDailyShiftReport):string{
 const m=shift.metadata,auto=m.close_reason==="recycling_daily_auto_close_midnight";
 const opening=shift.openingCash===null?"ยังไม่ยืนยัน":fmt(Number(shift.openingCash));
 const expected=shift.expectedCash===null?minor(m.recycling_expected_cash_minor):fmt(Number(shift.expectedCash));
 const counted=shift.actualCash===null?"รอตรวจนับ":fmt(Number(shift.actualCash));
 return [
  "CpiPOS · CUSTOM Recycling","ใบสรุปปิดกะประจำวัน",shift.branchName,
  "กะ: "+shift.id.slice(0,12),"เปิด: "+dt(shift.openedAt),
  "ปิด: "+dt(shift.closedAt),
  "รับซื้อ "+count(m.recycling_buy_count)+" บิล",
  "ขายออก "+count(m.recycling_sell_count)+" บิล",
  "เงินสดรับ "+minor(m.recycling_cash_in_minor),
  "เงินสดจ่าย "+minor(m.recycling_cash_out_minor),
  "เงินโอนเข้า "+minor(m.recycling_transfer_in_minor),
  "เงินโอนออก "+minor(m.recycling_transfer_out_minor),
  "เงินต้นกะ "+opening,"เงินสดคาดการณ์ "+expected,
  "เงินตรวจนับจริง "+counted,
  auto?"ปิดอัตโนมัติ · รอตรวจเงินสด":"ปิดโดยผู้ใช้งาน",
  "ไม่ใช่ใบเสร็จหรือใบกำกับภาษี"
 ].join("\n");
}
export function renderRecyclingDailyShiftCloseHtml(shift:RecyclingDailyShiftReport,paper:58|80){
 const m=shift.metadata,auto=m.close_reason==="recycling_daily_auto_close_midnight";
 const opening=shift.openingCash===null?"ยังไม่ยืนยัน":fmt(Number(shift.openingCash));
 const expected=shift.expectedCash===null?minor(m.recycling_expected_cash_minor):fmt(Number(shift.expectedCash));
 const actual=shift.actualCash===null?"รอตรวจนับ":fmt(Number(shift.actualCash));
 const rows:[string,string][]=[
  ["รับซื้อเข้าร้าน",count(m.recycling_buy_count)+" บิล"],["ขายออก",count(m.recycling_sell_count)+" บิล"],
  ["เงินสดรับจากขายออก",minor(m.recycling_cash_in_minor)],
  ["เงินสดจ่ายรับซื้อ",minor(m.recycling_cash_out_minor)],
  ["เงินสดสุทธิ",minor(m.recycling_cash_net_minor)],
  ["รับโอน",minor(m.recycling_transfer_in_minor)],
  ["จ่ายโอน",minor(m.recycling_transfer_out_minor)],
  ["เงินสดต้นกะ",opening],["คาดการณ์เงินสด",expected],["เงินตรวจนับจริง",actual]
 ];
 const body=rows.map(([key,value])=>'<div class="r"><span>'+safe(key)+'</span><strong>'+safe(value)+'</strong></div>').join("");
 return '<!doctype html><html lang="th"><head><meta charset="utf-8"/><title>ปิดกะ CUSTOM Recycling</title>'
  +'<style>@page{size:'+paper+'mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:'+paper+'mm;background:#fff;color:#000;'
  +'font:11px/1.4 Tahoma,"Noto Sans Thai",sans-serif}main{width:'+(paper===80?74:53)+'mm;padding:3mm 1mm;margin:0 auto}'
  +'h1{font-size:14px;text-align:center;margin:0 0 3mm}.r{display:flex;justify-content:space-between;gap:3mm;margin:2mm 0}'
  +'.r span{flex:1;min-width:0;overflow-wrap:anywhere}.r strong{text-align:right;white-space:nowrap}'
  +'p{font-size:10px;margin:2mm 0;overflow-wrap:anywhere}hr{border:0;border-top:1px dashed #000;margin:3mm 0}</style></head>'
  +'<body><main><h1>สรุปปิดกะ · CUSTOM Recycling</h1>'
  +'<p>สาขา: '+safe(shift.branchName)+'</p><p>กะ: '+safe(shift.id.slice(0,12))+'</p>'
  +'<p>เปิด: '+safe(dt(shift.openedAt))+'</p><p>ปิด: '+safe(dt(shift.closedAt))+'</p>'
  +'<hr/>'+body+'<hr/><p>'+(auto?'ปิดกะอัตโนมัติ · ต้องตรวจนับเงินสดและกระทบยอด':'ปิดโดยผู้ใช้งาน · ตรวจสอบยอดตามบันทึกจริง')
  +'</p><p>ยอดโอนไม่ใช่หลักฐานธนาคาร · ไม่ใช่ใบเสร็จหรือใบกำกับภาษี</p></main></body></html>';
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Never infer cash physically changed from a database approval.
 * The approver must explicitly inspect the cash repayment and physical stock.
 */
export function RecyclingVoidTransaction({
  transactionId,direction,settlement,enabled,startExpanded=false
}: {
  transactionId:string;
  direction:"buy"|"sell";
  settlement:"cash"|"bank_transfer"|"credit";
  enabled:boolean;
  startExpanded?:boolean;
}) {
  const router=useRouter();
  const [expanded,setExpanded]=useState(startExpanded);
  const [reason,setReason]=useState("");
  const [stockChecked,setStockChecked]=useState(false);
  const [cashConfirmed,setCashConfirmed]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [confirmOpen,setConfirmOpen]=useState(false);
  const cancelConfirmRef=useRef<HTMLButtonElement>(null);
  // Keep the same request ID on an uncertain network outcome. A retry must
  // never create a separate financial reversal for the same VOID request.
  const voidRequestIdRef=useRef("");
  useEffect(()=>{
    if(confirmOpen)window.requestAnimationFrame(()=>cancelConfirmRef.current?.focus());
  },[confirmOpen]);
  const bankBlocked=settlement==="bank_transfer";
  async function submit() {
    if (!confirmOpen || saving || !enabled || bankBlocked || !stockChecked ||
        (settlement==="cash" && !cashConfirmed) ||
        reason.trim().length<10 || reason.trim().length>500) return;
    if(!voidRequestIdRef.current)voidRequestIdRef.current=crypto.randomUUID();
    setSaving(true);setMessage("");setError("");
    try {
      const response=await fetch(`/api/pos/recycling/transactions/${transactionId}/void`,{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          request_id:voidRequestIdRef.current,
          reason:reason.trim(),
          stock_verified:true,
          cash_returned_confirmed:cashConfirmed
        })
      });
      const body=await response.json().catch(()=>null) as {
        data?:{voided?:{status?:string;receipt_no?:string}};
        error?:{code?:string;message?:string}
      }|null;
      if (!response.ok || body?.data?.voided?.status!=="voided") {
        const codes:Record<string,string>={
          recycling_void_self_approval_forbidden:"บัญชีผู้ใช้ไม่มีสิทธิ์ยกเลิกบิลนี้โดยตรง",
          recycling_void_historical_replay_required:"บิลนี้เกี่ยวข้องกับการปรับต้นทุนย้อนหลัง ไม่สามารถคืนยอดสต๊อกเดิมได้",
          recycling_void_material_has_later_movement:"วัสดุมีการเคลื่อนไหวสต๊อกเพิ่มเติมแล้ว กรุณาทำเอกสารปรับปรุงแทน",
          recycling_void_finance_already_posted:"รายการนี้โพสต์เข้าบัญชีแล้ว ต้องจัดทำเอกสารกลับรายการทางบัญชี",
          recycling_void_shift_already_closed:"กะนี้ปิดแล้ว ไม่อนุญาตให้แก้รายการย้อนหลัง",
          recycling_void_bank_reversal_requires_finance:"รายการโอนธนาคารต้องใช้เอกสารปรับปรุงและหลักฐานจากบัญชี",
          recycling_void_cash_drawer_insufficient:"เงินสดในกะไม่เพียงพอสำหรับคืนเงินจากการยกเลิก"
        };
        const code=body?.error?.code??"";
        setError(codes[code]??body?.error?.message??"ยกเลิกไม่สำเร็จ กรุณาตรวจสอบสิทธิ์และสถานะธุรกรรม");
        return;
      }
      setMessage("บันทึกการยกเลิกแล้ว ยอดสต๊อกคืนตามหลักฐานเดิม สามารถพิมพ์ใบเดิมที่ประทับสถานะยกเลิกได้");
      voidRequestIdRef.current="";
      setConfirmOpen(false);
      setExpanded(false);
      router.refresh();
    } catch {
      setError("การเชื่อมต่อขัดข้อง กรุณาตรวจสอบสถานะเอกสารก่อนส่งคำสั่งอีกครั้ง");
    } finally {
      setSaving(false);
    }
  }
  return <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 print:hidden">
    <h2 className="font-bold text-rose-900">ยกเลิกเอกสารรับซื้อ–ขายออก (VOID)</h2>
    <p className="mt-1 text-xs text-rose-800">ผู้มีสิทธิ์ยืนยันการยกเลิกได้สำหรับกะที่ยังเปิด และบิลที่ยังไม่มีการโพสต์ GL หรือการเคลื่อนไหวสต๊อกภายหลัง</p>
    {!enabled && <p className="mt-2 text-xs font-bold text-amber-900">
      ปิดการยกเลิกจริงระหว่างตรวจความถูกต้องของระบบบัญชีและสต๊อก
    </p>}
    {bankBlocked ? <p className="mt-2 text-xs text-rose-900">
      รายการโอนธนาคารใช้วิธียกเลิกนี้ไม่ได้ ต้องให้ฝ่ายบัญชีตรวจหลักฐานคืนเงินและออกเอกสารปรับปรุง
    </p> : <>
      <button type="button" className="mt-3 rounded-lg border border-rose-400 px-3 py-2 text-sm font-bold text-rose-800 disabled:opacity-40"
        disabled={!enabled || saving} onClick={()=>setExpanded(v=>!v)}>
        {expanded?"ปิดฟอร์ม":"เปิดแบบฟอร์มตรวจสอบก่อน VOID"}
      </button>
      {expanded && <div className="mt-3 space-y-3">
        <label className="block text-sm font-semibold text-slate-800">
          เหตุผลยกเลิก (10–500 ตัวอักษร)
          <textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3" maxLength={500}
            placeholder="ระบุข้อผิดพลาดเดิมและหลักฐานประกอบการคืนสินค้า/เงิน"/>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-900">
          <input type="checkbox" checked={stockChecked} onChange={e=>setStockChecked(e.target.checked)}/>
          <span>ตรวจนับวัสดุจริงแล้ว และยืนยันว่าจะคืนยอดสต๊อกของเอกสารนี้ตามหลักฐานต้นฉบับ</span>
        </label>
        {settlement==="cash" && <label className="flex items-start gap-2 text-sm text-slate-900">
          <input type="checkbox" checked={cashConfirmed} onChange={e=>setCashConfirmed(e.target.checked)}/>
          <span>{direction==="buy" ?
            "ยืนยันว่าผู้ขายวัสดุคืนเงินสดที่เคยรับซื้อเข้าลิ้นชักเงินจริงแล้ว" :
            "ยืนยันว่าร้านได้คืนเงินสดให้ผู้ซื้อสินค้าจริงแล้ว"}</span>
        </label>}
        <button type="button" onClick={()=>{setError("");setConfirmOpen(true);}}
          disabled={!enabled || saving || !stockChecked || reason.trim().length<10 ||
            (settlement==="cash"&&!cashConfirmed)}
          className="rounded-lg bg-rose-700 px-4 py-3 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-40">
          ตรวจสอบและยืนยันการยกเลิก (VOID)
        </button>
      </div>}
    </>}
    {confirmOpen && <div role="presentation" className="fixed inset-0 z-[1850] flex items-center justify-center bg-slate-950/70 p-3">
      <div role="alertdialog" aria-modal="true" aria-labelledby="recycling-void-confirm-title"
        aria-describedby="recycling-void-confirm-description"
        data-testid="recycling-void-confirm-dialog"
        onKeyDown={event=>{
          if(event.key==="Escape"){
            event.preventDefault();event.stopPropagation();
            if(!saving)setConfirmOpen(false);
          }
        }}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-rose-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-white text-xl text-rose-700">!</div>
            <div className="min-w-0">
              <h3 id="recycling-void-confirm-title" className="text-lg font-extrabold text-rose-900">
                ยืนยันยกเลิกเอกสาร (VOID)
              </h3>
              <p className="mt-1 text-xs leading-5 text-rose-800">
                การดำเนินการนี้มีผลต่อสต๊อกและเงินสด ต้องตรวจสอบหลักฐานก่อนเสมอ
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
          <p id="recycling-void-confirm-description" className="leading-6">
            ระบบจะเก็บเอกสารต้นฉบับและประวัติการยกเลิกถาวร
            ไม่สามารถใช้วิธีนี้กับกะที่ปิดแล้ว รายการที่โพสต์บัญชีแล้ว
            หรือวัสดุที่มีการเคลื่อนไหวสต๊อกภายหลัง
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-6">
            <p><strong>ประเภท:</strong> {direction==="buy"?"รับซื้อเข้าร้าน":"ขายออก"}</p>
            <p><strong>วิธีชำระ:</strong> {settlement==="cash"?"เงินสด":settlement==="credit"?"เครดิต":"โอนเงิน"}</p>
            <p><strong>เหตุผล:</strong> <span className="break-words">{reason.trim()}</span></p>
          </div>
          {error&&<p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">{error}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button type="button" ref={cancelConfirmRef}
            disabled={saving} onClick={()=>setConfirmOpen(false)}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 disabled:opacity-50">
            ไม่ยกเลิก / กลับ
          </button>
          <button type="button" onClick={()=>void submit()} disabled={saving}
            data-testid="recycling-void-final-confirm"
            className="min-h-11 rounded-lg bg-rose-700 px-5 text-sm font-extrabold text-white hover:bg-rose-800 disabled:opacity-50">
            {saving?"กำลังตรวจสอบ...":"ยืนยันยกเลิกเอกสาร"}
          </button>
        </div>
      </div>
    </div>}
    {message && <p role="status" className="mt-3 text-sm font-semibold text-emerald-900">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm font-semibold text-rose-800">{error}</p>}
  </section>;
}

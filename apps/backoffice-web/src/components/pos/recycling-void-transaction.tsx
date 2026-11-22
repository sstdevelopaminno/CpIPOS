"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const bankBlocked=settlement==="bank_transfer";
  async function submit() {
    if (saving || !enabled || bankBlocked || !stockChecked ||
        (settlement==="cash" && !cashConfirmed) ||
        reason.trim().length<10 || reason.trim().length>500) return;
    if (!window.confirm(
      "ยืนยันยกเลิกเอกสารต้นฉบับ? ระบบจะคืนยอดสต๊อกตามหลักฐานเดิม และเก็บประวัติการยกเลิกถาวร ไม่สามารถนำรายการที่โพสต์บัญชีแล้วหรือกะที่ปิดแล้วกลับมาแก้ด้วยวิธีนี้"
    )) return;
    setSaving(true);setMessage("");setError("");
    try {
      const response=await fetch(`/api/pos/recycling/transactions/${transactionId}/void`,{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          request_id:crypto.randomUUID(),
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
          recycling_void_self_approval_forbidden:"ต้องให้ผู้อนุมัติคนละคนกับพนักงานที่บันทึกรายการเดิม",
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
      setExpanded(false);
      router.refresh();
    } catch {
      setError("การเชื่อมต่อขัดข้อง กรุณาตรวจสอบสถานะเอกสารก่อนส่งคำสั่งอีกครั้ง");
    } finally {
      setSaving(false);
    }
  }
  return <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 print:hidden">
    <h2 className="font-bold text-rose-900">ขอยกเลิกเอกสารรับซื้อ–ขายออก (VOID)</h2>
    <p className="mt-1 text-xs text-rose-800">ต้องมีผู้อนุมัติคนละคนกับผู้บันทึกเดิม และต้องเป็นกะที่ยังเปิดโดยไม่มีการโพสต์บัญชีหลักหรือเคลื่อนไหวสต๊อกต่อจากบิลนี้</p>
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
        <button type="button" onClick={()=>void submit()}
          disabled={!enabled || saving || !stockChecked || reason.trim().length<10 ||
            (settlement==="cash"&&!cashConfirmed)}
          className="rounded-lg bg-rose-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-40">
          {saving?"กำลังตรวจสอบก่อน VOID...":"ยืนยันยกเลิกโดยหัวหน้างาน / บัญชี"}
        </button>
      </div>}
    </>}
    {message && <p role="status" className="mt-3 text-sm font-semibold text-emerald-900">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm font-semibold text-rose-800">{error}</p>}
  </section>;
}

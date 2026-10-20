"use client";

import { useEffect,useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {AppLanguageSwitcher} from "@/components/i18n/app-language-switcher";
import {useAppLanguage} from "@/lib/app-language-client";

type Quote={
  token:string|null;store:{code:string;name:string};
  package:{name:string;amount:number;currency:string;billing_interval?:string;next_period_start?:string|null;next_period_end?:string|null};
  issuer:{bank_name:string;account_name:string;account_number:string;promptpay_id:string};
  pending_review:{status:string;has_evidence?:boolean;review_due_at:string|null}|null;
  qr_data_url:string|null;
};
type Submission={id:string;status:string;provisional_access_granted:boolean;provisional_access_expires_at:string|null};
type Envelope<T>={data?:T;error?:{code:string;message:string}};
const words={
  th:{
    title:"ชำระเงินแพ็กเกจ CpiPOS",store:"ร้านค้า",package:"แพ็กเกจ",cycle:"รอบชำระ",amount:"ยอดที่ต้องชำระ",
    pay:"ชำระเงิน",account:"เลขบัญชี",bank:"ธนาคาร",owner:"ชื่อบัญชี",qr:"สแกน QR เพื่อชำระ",
    transfer:"ชำระเงินและแนบสลิป",submit:"ส่งหลักฐานการชำระ",slip:"แนบสลิป (JPG, PNG, WEBP ไม่เกิน 4 MB)",
    note:"หมายเหตุ (ไม่บังคับ)",back:"กลับไปเลือกเครื่อง",support:"ติดต่อ Support",close:"ปิด",
    pending:"ส่งหลักฐานแล้ว อยู่ระหว่างรอ IT ตรวจสอบ",noApproval:"กรุณาติดต่อ Support เพื่อตรวจสอบสถานะแพ็กเกจ",
    granted:"เปิดใช้งานชั่วคราวแล้ว",grantedMsg:"เข้า POS ได้ทันที โดยฝ่าย IT ต้องยืนยันการชำระภายใน 3 วัน หากไม่ยืนยัน ระบบจะกลับมาล็อกอัตโนมัติ",
    expiry:"สิทธิ์ชั่วคราวสิ้นสุด",review:"กำหนดตรวจสอบภายใน",waiting:"กำลังโหลดรอบบิลจากระบบ IT...",
    sending:"กำลังตรวจสอบหลักฐาน...",invalid:"สลิปยังไม่ผ่านการตรวจสอบอัตโนมัติ ระบบบันทึกหลักฐานให้ IT แล้ว กรุณาติดต่อ Support",
    paymentHint:"ยอดและบัญชีรับชำระดึงจากฝ่าย IT โดยตรง",notpayable:"รายการนี้ต้องให้ฝ่าย IT ตรวจสอบ โปรดติดต่อ Support",
    sent:"ได้รับสลิปแล้ว",
  },
  en:{
    title:"Pay CpiPOS subscription",store:"Store",package:"Package",cycle:"Next billing period",amount:"Amount due",
    pay:"Pay now",account:"Account number",bank:"Bank",owner:"Account name",qr:"Scan to pay",
    transfer:"Pay and attach slip",submit:"Submit payment evidence",slip:"Attach slip (JPG PNG WEBP max 4 MB)",
    note:"Note (optional)",back:"Back to device selection",support:"Contact Support",close:"Close",
    pending:"Payment evidence submitted, awaiting IT review",noApproval:"Contact Support to review package status",
    granted:"Temporary access is active",grantedMsg:"You can enter POS now. IT must confirm payment within three days or the system automatically locks again.",
    expiry:"Temporary access ends",review:"Expected review by",waiting:"Loading the IT billing cycle...",
    sending:"Checking payment evidence...",invalid:"Automatic slip verification did not pass. IT has received the evidence; contact Support.",
    paymentHint:"The amount and bank details come directly from IT settings",notpayable:"IT assistance is required for this payment",
    sent:"Payment evidence received",
  },
  lo:{
    title:"ຊຳລະຄ່າແພັກເກດ CpiPOS",store:"ຮ້ານຄ້າ",package:"ແພັກເກດ",cycle:"ຮອບບິນຕໍ່ໄປ",amount:"ຈຳນວນເງິນທີ່ຕ້ອງຊຳລະ",
    pay:"ຊຳລະເງິນ",account:"ເລກບັນຊີ",bank:"ທະນາຄານ",owner:"ຊື່ບັນຊີ",qr:"ສະແກນ QR ເພື່ອຊຳລະ",
    transfer:"ຊຳລະເງິນ ແລະ ແນບສະລິບ",submit:"ສົ່ງຫຼັກຖານການຊຳລະ",slip:"ແນບສະລິບ JPG PNG WEBP ບໍ່ເກີນ 4 MB",
    note:"ໝາຍເຫດ",back:"ກັບໄປເລືອກເຄື່ອງ",support:"ຕິດຕໍ່ Support",close:"ປິດ",
    pending:"ສົ່ງຫຼັກຖານແລ້ວ ກຳລັງລໍຖ້າ IT ກວດສອບ",noApproval:"ກະລຸນາຕິດຕໍ່ Support",
    granted:"ເປີດໃຊ້ງານຊົ່ວຄາວແລ້ວ",grantedMsg:"ສາມາດເຂົ້າ POS ໄດ້ທັນທີ ແລະ IT ຕ້ອງຢືນຢັນພາຍໃນ 3 ມື້ ບໍ່ດັ່ງນັ້ນຈະລັອກອີກ",
    expiry:"ສິດຊົ່ວຄາວສິ້ນສຸດ",review:"ກຳນົດກວດສອບ",waiting:"ກຳລັງໂຫຼດຮອບບິນຈາກ IT...",
    sending:"ກຳລັງກວດສອບສະລິບ...",invalid:"ການກວດສະລິບອັດຕະໂນມັດບໍ່ຜ່ານ ສົ່ງໃຫ້ IT ແລ້ວ ກະລຸນາຕິດຕໍ່ Support",
    paymentHint:"ຍອດເງິນ ແລະ ບັນຊີມາຈາກ IT ໂດຍກົງ",notpayable:"ລາຍການນີ້ຕ້ອງໃຫ້ IT ຊ່ວຍ",
    sent:"ໄດ້ຮັບສະລິບແລ້ວ"
  }
};
function date(iso:string|null|undefined,locale:string){
  if(!iso||!Number.isFinite(Date.parse(iso)))return "—";
  return new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeZone:"Asia/Bangkok"}).format(new Date(iso));
}
const button="flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-center text-sm font-bold disabled:opacity-50";
export default function PreEntryPackagePaymentPage(){
  const router=useRouter();
  const {lang,setLanguage}=useAppLanguage("th");
  const t=words[lang];
  const [quote,setQuote]=useState<Quote|null>(null);
  const [submitted,setSubmitted]=useState<Submission|null>(null);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(false);
  const [slip,setSlip]=useState<File|null>(null);
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    void fetch("/api/auth/subscription-checkout",{cache:"no-store"})
      .then(async res=>{
        const body=await res.json() as Envelope<Quote>;
        if(!res.ok||!body.data)throw Error(body.error?.message||words.th.notpayable);
        if(active)setQuote(body.data);
      }).catch(e=>{if(active)setError(e instanceof Error?e.message:words.th.notpayable);})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);
  async function sendSlip(event:FormEvent){
    event.preventDefault();
    if(!quote?.token||busy||!slip)return;
    if(slip.size>4*1024*1024){setError("ไฟล์สลิปเกิน 4 MB");return;}
    setBusy(true);setError("");
    try{
      const form=new FormData();
      form.append("checkout_token",quote.token);
      form.append("slip",slip);
      form.append("note",note);
      const res=await fetch("/api/auth/subscription-checkout",{method:"POST",body:form});
      const body=await res.json() as Envelope<Submission>;
      if(!res.ok||!body.data)throw Error(body.error?.message||t.notpayable);
      setSubmitted(body.data);setModal(false);
    }catch(e){setError(e instanceof Error?e.message:t.notpayable);}
    finally{setBusy(false);}
  }
  const locale=lang==="lo"?"lo-LA":lang==="en"?"en-GB":"th-TH";
  const amount=quote?.package.amount??0;
  const money=new Intl.NumberFormat(locale,{style:"currency",currency:"THB"}).format(amount);
  const bank=quote?.issuer;
  return <main className="min-h-screen bg-slate-100 px-3 py-8 text-slate-800 sm:px-6">
    <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 shadow-lg sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold tracking-widest text-blue-700">CpiPOS · SUBSCRIPTION</p>
          <h1 className="mt-2 text-2xl font-extrabold text-slate-800">{t.title}</h1></div>
        <AppLanguageSwitcher lang={lang} onChange={setLanguage}/>
      </div>
      {error?<p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>:null}
      {loading?<p className="mt-6 text-slate-500">{t.waiting}</p>:null}
      {quote?<div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-500">{t.store}</p>
          <p className="text-lg font-extrabold text-slate-800">{quote.store.name} · {quote.store.code}</p>
          <p className="mt-3 text-sm text-slate-500">{t.package}</p>
          <p className="font-semibold text-slate-800">{quote.package.name}</p>
          {quote.package.next_period_start?<p className="mt-2 text-sm text-slate-600">{t.cycle}: {date(quote.package.next_period_start,locale)} – {date(quote.package.next_period_end,locale)}</p>:null}
        </div>
        {submitted?<div role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="text-lg font-bold text-blue-900">{submitted.provisional_access_granted?t.granted:t.sent}</h2>
          <p className="mt-2 text-sm leading-6 text-blue-800">{submitted.provisional_access_granted?t.grantedMsg:t.invalid}</p>
          {submitted.provisional_access_expires_at?<p className="mt-2 font-bold text-blue-900">{t.expiry}: {date(submitted.provisional_access_expires_at,locale)}</p>:null}
        </div>:quote.pending_review?<div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <p className="font-bold">{t.pending}</p>
          <p className="mt-1 text-sm">{quote.pending_review.has_evidence?t.noApproval:t.notpayable}</p>
          {quote.pending_review.review_due_at?<p className="mt-1 text-sm">{t.review}: {date(quote.pending_review.review_due_at,locale)}</p>:null}
        </div>:<div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center">
          <p className="font-semibold text-blue-700">{t.amount}</p>
          <p className="mt-2 text-4xl font-extrabold tabular-nums text-blue-900">{money}</p>
          <p className="mt-2 text-xs text-slate-600">{t.paymentHint}</p>
          <button type="button" onClick={()=>setModal(true)} className={button+" mx-auto mt-5 w-full bg-blue-700 !text-white hover:bg-blue-800"}>{t.pay}</button>
        </div>}
      </div>:null}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button type="button" className={button+" border border-slate-300 bg-slate-50 text-slate-700"} onClick={()=>router.push("/login/devices")}>{t.back}</button>
        <button type="button" className={button+" bg-emerald-700 !text-white"} onClick={()=>router.push("/login/support-chat")}>{t.support}</button>
      </div>
    </section>
    {modal&&quote?.token?<div role="dialog" aria-modal="true" aria-label={t.transfer}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
      <form onSubmit={sendSlip} className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-800">{t.transfer}</h2>
          <button type="button" className="text-sm font-semibold text-slate-600" onClick={()=>setModal(false)}>{t.close}</button>
        </div>
        <p className="text-center text-3xl font-extrabold text-blue-900">{money}</p>
        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <p>{t.bank}: <strong>{bank?.bank_name||"—"}</strong></p>
          <p>{t.owner}: <strong>{bank?.account_name||"—"}</strong></p>
          <p>{t.account}: <strong className="select-all">{bank?.account_number||"—"}</strong></p>
          {bank?.promptpay_id?<p>PromptPay: <strong className="select-all">{bank.promptpay_id}</strong></p>:null}
        </div>
        {quote.qr_data_url?<div className="flex flex-col items-center gap-2">
          <p className="text-sm font-bold text-blue-800">{t.qr}</p>
          <Image src={quote.qr_data_url} alt="PromptPay QR" width={230} height={230} unoptimized className="rounded-xl border border-slate-200 p-2"/>
        </div>:null}
        <label className="block text-sm font-semibold text-slate-700">{t.slip}
          <input type="file" accept="image/png,image/jpeg,image/webp" required
            onChange={e=>setSlip(e.target.files?.[0]||null)}
            className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm"/>
        </label>
        <label className="block text-sm font-semibold text-slate-700">{t.note}
          <textarea rows={2} value={note} onChange={e=>setNote(e.target.value.slice(0,500))}
            className="mt-2 w-full rounded-xl border border-slate-300 p-3"/>
        </label>
        <button className={button+" w-full bg-blue-700 !text-white"} type="submit" disabled={busy||!slip}>{busy?t.sending:t.submit}</button>
      </form>
    </div>:null}
  </main>;
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppLanguageSwitcher } from "@/components/i18n/app-language-switcher";
import { useAppLanguage } from "@/lib/app-language-client";

type CatalogItem = { id:string;code:string;name:string;contact_sales:boolean;monthly_price:number|null;yearly_price:number|null };
type CheckoutReview = {status:string;submitted_at:string|null;review_due_at:string|null};
type Quote = {
  token:string;store:{code:string;name:string};
  package:{name:string;amount:number;currency:string;billing_interval:string};
  issuer:{name?:string;bank_name?:string;account_name?:string;account_number?:string;promptpay_id?:string};
  pending_review:CheckoutReview|null;
};
type ResponseEnvelope<T> = {data?:T|null;error?:{code?:string;message?:string}|null};
const localeCopy = {
  th:{
    title:"ชำระเงินแพ็กเกจ CpiPOS",intro:"ยืนยันรหัสร้านและ PIN เจ้าของร้านหรือผู้จัดการเพื่อเลือกแพ็กเกจ แล้วแนบสลิปส่งให้ฝ่าย IT ตรวจสอบ",
    store:"รหัสร้าน",pin:"PIN เจ้าของร้าน / ผู้จัดการ",package:"แพ็กเกจ",period:"รอบชำระ",month:"รายเดือน",year:"รายปี",
    verify:"ตรวจสอบราคาและบัญชีชำระ",loading:"กำลังตรวจสอบ...",back:"กลับไปเลือกเครื่อง",
    amount:"ยอดที่ต้องชำระ",bank:"บัญชีรับชำระ",account:"ชื่อบัญชี",number:"เลขบัญชี",promptpay:"พร้อมเพย์",
    slip:"อัปโหลดสลิป (JPG, PNG, WebP ไม่เกิน 4 MB)",note:"หมายเหตุ (ไม่บังคับ)",
    submit:"ส่งสลิปให้ฝ่าย IT ตรวจสอบ",submitting:"กำลังส่งหลักฐาน...",success:"รับหลักฐานการชำระเงินแล้ว",
    pending:"อยู่ระหว่างรอฝ่าย IT ตรวจสอบ",pendingNote:"ระบบยังล็อกการขายไว้จนกว่าฝ่าย IT จะตรวจสอบเงินเข้าและกดอนุมัติ โดยตั้งเป้าตรวจสอบภายใน 3 วัน ไม่มีการปลดล็อกอัตโนมัติเมื่อครบกำหนด",
    due:"กำหนดตรวจสอบโดยประมาณ",request:"เลขอ้างอิงคำขอ",support:"ติดต่อ Support",
    unavailable:"ไม่มีแพ็กเกจที่เปิดขายด้วยตนเอง กรุณาติดต่อ Support",error:"ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง",
    selectSlip:"กรุณาเลือกสลิปก่อนส่ง",supportCustom:"แพ็กเกจ CUSTOM ต้องให้ฝ่าย IT ตกลงรายละเอียดก่อน",
    fileTooLarge:"ไฟล์สลิปต้องไม่เกิน 4 MB",locked:"ส่งสลิปแล้วไม่ได้เปิดระบบทันที ต้องรอ IT อนุมัติก่อน"
  },
  en:{
    title:"Pay for CpiPOS package",intro:"Verify the store code and owner/manager PIN, choose a package and upload your payment slip for IT review.",
    store:"Store code",pin:"Owner / manager PIN",package:"Package",period:"Billing cycle",month:"Monthly",year:"Yearly",
    verify:"Verify pricing and bank details",loading:"Checking...",back:"Back to terminals",
    amount:"Amount due",bank:"Receiving bank",account:"Account name",number:"Account number",promptpay:"PromptPay",
    slip:"Upload payment slip (JPG, PNG, WebP, max 4 MB)",note:"Note (optional)",
    submit:"Submit payment slip to IT",submitting:"Submitting...",success:"Payment evidence received",
    pending:"Pending IT review",pendingNote:"Cashier access remains locked until IT verifies receipt of funds and explicitly approves. Target review: within 3 days. There is no automatic unlock after that time.",
    due:"Estimated review date",request:"Request reference",support:"Contact Support",
    unavailable:"No self-service packages are available. Contact Support.",error:"Unable to continue. Please retry.",
    selectSlip:"Choose a payment slip first",supportCustom:"CUSTOM packages require an IT agreement before payment.",
    fileTooLarge:"Slip must be 4 MB or less",locked:"Uploading a slip does not unlock POS. IT approval is required."
  },
  lo:{
    title:"ຊຳລະເງິນແພັກເກດ CpiPOS",intro:"ຢືນຢັນລະຫັດຮ້ານ ແລະ PIN ເຈົ້າຂອງ/ຜູ້ຈັດການ ເລືອກແພັກເກດ ແລ້ວສົ່ງສະລິບໃຫ້ IT ກວດສອບ",
    store:"ລະຫັດຮ້ານ",pin:"PIN ເຈົ້າຂອງ / ຜູ້ຈັດການ",package:"ແພັກເກດ",period:"ຮອບຊຳລະ",month:"ລາຍເດືອນ",year:"ລາຍປີ",
    verify:"ກວດສອບລາຄາ ແລະ ບັນຊີຮັບເງິນ",loading:"ກຳລັງກວດສອບ...",back:"ກັບໄປເລືອກເຄື່ອງ",
    amount:"ຈຳນວນເງິນ",bank:"ທະນາຄານຮັບເງິນ",account:"ຊື່ບັນຊີ",number:"ເລກບັນຊີ",promptpay:"ພ້ອມເພ",
    slip:"ອັບໂຫຼດສະລິບ (JPG, PNG, WebP ບໍ່ເກີນ 4 MB)",note:"ໝາຍເຫດ (ບໍ່ບັງຄັບ)",
    submit:"ສົ່ງສະລິບໃຫ້ IT ກວດສອບ",submitting:"ກຳລັງສົ່ງ...",success:"ໄດ້ຮັບສະລິບແລ້ວ",
    pending:"ກຳລັງລໍຖ້າ IT ກວດສອບ",pendingNote:"ລະບົບຍັງລັອກການຂາຍ ຈົນກວ່າ IT ຈະກວດສອບເງິນ ແລະ ອະນຸມັດ. ເປົ້າໝາຍກວດສອບພາຍໃນ 3 ມື້ ແລະ ບໍ່ປົດລັອກອັດຕະໂນມັດ",
    due:"ຄາດວ່າກວດສອບ",request:"ເລກອ້າງອີງ",support:"ຕິດຕໍ່ Support",
    unavailable:"ບໍ່ມີແພັກເກດສຳລັບຊື້ເອງ ກະລຸນາຕິດຕໍ່ Support",error:"ດຳເນີນການບໍ່ໄດ້ ກະລຸນາລອງໃໝ່",
    selectSlip:"ກະລຸນາເລືອກສະລິບ",supportCustom:"ແພັກເກດ CUSTOM ຕ້ອງມີຂໍ້ຕົກລົງກັບ IT ກ່ອນ",
    fileTooLarge:"ສະລິບຕ້ອງບໍ່ເກີນ 4 MB",locked:"ສົ່ງສະລິບແລ້ວຍັງບໍ່ປົດລັອກ ຕ້ອງລໍຖ້າ IT ອະນຸມັດ"
  }
};

function dueLabel(value:string|null,lang:"th"|"en"|"lo") {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat(lang==="lo"?"lo-LA":lang==="en"?"en-GB":"th-TH",{
    timeZone:"Asia/Bangkok",dateStyle:"medium",timeStyle:"short"
  }).format(new Date(value));
}
const button = "min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition disabled:opacity-60";
const field = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export default function PreEntryPackagePaymentPage() {
  const router=useRouter();
  const {lang,setLanguage}=useAppLanguage("th");
  const t=localeCopy[lang];
  const [storeCode,setStoreCode]=useState("");
  const [pin,setPin]=useState("");
  const [catalog,setCatalog]=useState<CatalogItem[]>([]);
  const [packageId,setPackageId]=useState("");
  const [interval,setInterval]=useState<"monthly"|"yearly">("monthly");
  const [quote,setQuote]=useState<Quote|null>(null);
  const [slip,setSlip]=useState<File|null>(null);
  const [note,setNote]=useState("");
  const [submitted,setSubmitted]=useState<{id:string;status:string}|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    try { setStoreCode(window.sessionStorage.getItem("cpipos_checkout_store_code") ?? ""); } catch {}
    let live=true;
    void fetch("/api/public/subscription-checkout",{cache:"no-store"})
      .then(async response=>{
        const json=await response.json() as ResponseEnvelope<{packages:CatalogItem[]}>;
        if(!response.ok||!json.data)throw new Error(json.error?.message??"");
        if(!live)return;
        const available=json.data.packages.filter(p=>!p.contact_sales && (p.monthly_price!==null||p.yearly_price!==null));
        setCatalog(available);
        setPackageId(available[0]?.id??"");
      }).catch(()=>{if(live)setError(localeCopy.th.error);})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[]);

  async function verify(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError("");setQuote(null);
    try {
      const response=await fetch("/api/public/subscription-checkout",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({store_code:storeCode.trim(),pin,package_id:packageId,billing_interval:interval})
      });
      const json=await response.json() as ResponseEnvelope<Quote>;
      if(!response.ok||!json.data)throw new Error(json.error?.message??t.error);
      setQuote(json.data);setPin("");
    }catch(e){setError(e instanceof Error?e.message:t.error);}finally{setBusy(false);}
  }

  async function sendEvidence(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!quote?.token || quote.pending_review || submitted)return;
    if(!slip){setError(t.selectSlip);return;}
    if(slip.size>4*1024*1024){setError(t.fileTooLarge);return;}
    setBusy(true);setError("");
    try{
      const form=new FormData();
      form.set("checkout_token",quote.token);
      form.set("slip",slip);
      form.set("note",note);
      const response=await fetch("/api/public/subscription-checkout/submit",{method:"POST",body:form});
      const json=await response.json() as ResponseEnvelope<{id:string;status:string}>;
      if(!response.ok||!json.data)throw new Error(json.error?.message??t.error);
      setSubmitted({id:json.data.id,status:json.data.status});
      setSlip(null);
    }catch(e){setError(e instanceof Error?e.message:t.error);}finally{setBusy(false);}
  }
  const fmt=(v:number,c:string)=>new Intl.NumberFormat(lang==="lo"?"lo-LA":lang==="en"?"en-US":"th-TH",{
    style:"currency",currency:c
  }).format(v);
  const review=quote?.pending_review;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-7 text-slate-800 sm:py-12">
      <div className="mx-auto w-full max-w-[740px] space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-xl sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-widest text-blue-700">CpiPOS · SUBSCRIPTION</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-800">{t.title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t.intro}</p>
          </div>
          <AppLanguageSwitcher lang={lang} onChange={setLanguage} />
        </header>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t.locked}</div>
        {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>:null}
        {submitted||review?(
          <section role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="font-bold text-blue-900">{submitted?t.success:t.pending}</h2>
            {submitted?<p className="mt-2 break-all text-xs text-blue-800">{t.request}: {submitted.id}</p>:null}
            {review?.review_due_at?<p className="mt-2 text-sm text-blue-800">{t.due}: {dueLabel(review.review_due_at,lang)}</p>:null}
            <p className="mt-3 text-sm leading-6 text-slate-700">{t.pendingNote}</p>
          </section>
        ):null}
        {!quote && !submitted?(
          <form onSubmit={verify} className="grid gap-4">
            <label className="block text-sm font-semibold text-slate-700">{t.store}
              <input className={field} value={storeCode} onChange={e=>setStoreCode(e.target.value)} autoComplete="off" required maxLength={32} />
            </label>
            <label className="block text-sm font-semibold text-slate-700">{t.pin}
              <input className={field} type="password" value={pin} onChange={e=>setPin(e.target.value)} autoComplete="off" required maxLength={32}/>
            </label>
            <label className="block text-sm font-semibold text-slate-700">{t.package}
              <select className={field} value={packageId} onChange={e=>setPackageId(e.target.value)} disabled={loading||busy} required>
                {catalog.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-700">{t.period}
              <select className={field} value={interval} onChange={e=>setInterval(e.target.value as "monthly"|"yearly")}>
                <option value="monthly">{t.month}</option><option value="yearly">{t.year}</option>
              </select>
            </label>
            {!loading&&catalog.length===0?<p className="text-sm text-amber-800">{t.unavailable}</p>:null}
            <button type="submit" disabled={busy||loading||!catalog.length} className={button+" bg-blue-700 text-white hover:bg-blue-800"}>
              {busy?t.loading:t.verify}
            </button>
          </form>
        ):null}
        {quote&&!review&&!submitted?(
          <section className="space-y-4">
            <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <strong className="text-lg text-slate-800">{quote.store.name} · {quote.package.name}</strong>
              <p className="font-bold text-blue-800">{t.amount}: {fmt(quote.package.amount,quote.package.currency)}</p>
              <p>{t.bank}: {quote.issuer.bank_name||"—"}</p>
              <p>{t.account}: {quote.issuer.account_name||"—"}</p>
              <p>{t.number}: {quote.issuer.account_number||"—"}</p>
              {quote.issuer.promptpay_id?<p>{t.promptpay}: {quote.issuer.promptpay_id}</p>:null}
            </div>
            <form onSubmit={sendEvidence} className="grid gap-4">
              <label className="block text-sm font-semibold text-slate-700">{t.slip}
                <input className={field} type="file" accept="image/png,image/jpeg,image/webp" required
                  onChange={e=>setSlip(e.target.files?.[0]??null)}/>
              </label>
              <label className="block text-sm font-semibold text-slate-700">{t.note}
                <textarea className={field} value={note} maxLength={500} onChange={e=>setNote(e.target.value)} rows={2}/>
              </label>
              <button type="submit" disabled={busy} className={button+" bg-blue-700 text-white hover:bg-blue-800"}>
                {busy?t.submitting:t.submit}
              </button>
            </form>
          </section>
        ):null}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button type="button" onClick={()=>router.push("/login/devices")} className={button+" border border-slate-300 bg-slate-50 text-slate-700"}>{t.back}</button>
          <a href="https://lin.ee/f1LXpAF" target="_blank" rel="noopener noreferrer"
            className={button+" flex items-center justify-center bg-emerald-700 text-center text-white hover:bg-emerald-800"}>{t.support}</a>
        </div>
      </div>
    </main>
  );
}

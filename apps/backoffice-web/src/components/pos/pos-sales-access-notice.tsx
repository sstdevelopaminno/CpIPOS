import Link from "next/link";
import type { PosSalesDenialReason } from "@/lib/pos-sales-page-denial";

const thai: Record<PosSalesDenialReason, string> = {
  menu: "เมนูหน้าขายยังไม่ได้รับอนุญาตจากฝ่าย IT สำหรับร้านนี้",
  feature: "สิทธิ์แคชเชียร์ของแพ็กเกจหรือสาขานี้ยังไม่เปิดใช้งาน",
  permission: "บัญชีนี้ไม่มีสิทธิ์เข้าหน้าขาย หรือสิทธิ์สาขาไม่พร้อมใช้งาน",
  shift: "ยังไม่มีกะที่เปิดใช้งาน กรุณาตรวจสอบกะก่อนเข้าหน้าขาย",
  subscription: "การเข้าใช้งานถูกระงับ กรุณาตรวจสอบสถานะแพ็กเกจ",
  mode: "ร้านหรือสาขานี้ยังไม่ได้รับสิทธิ์โหมดขายของชำ CUSTOM หรือสิทธิ์เครื่องสแกนไม่พร้อม"
};
const english: Record<PosSalesDenialReason, string> = {
  menu: "IT has not authorized the sales menu for this store.",
  feature: "Cashier access is not enabled for this package or branch.",
  permission: "This account cannot access the sales page or its branch.",
  shift: "No active shift is available. Check the shift before selling.",
  subscription: "Sales access is locked. Check the subscription status.",
  mode: "CUSTOM General Sale or barcode scanner access is not authorized for this store or branch."
};
const lao: Record<PosSalesDenialReason, string> = {
  menu: "IT ຍັງບໍ່ອະນຸຍາດເມນູຂາຍສຳລັບຮ້ານນີ້",
  feature: "ຍັງບໍ່ເປີດສິດຂາຍສຳລັບແພັກເກດ ຫຼື ສາຂານີ້",
  permission: "ບັນຊີນີ້ບໍ່ມີສິດເຂົ້າໜ້າຂາຍ ຫຼື ສາຂາ",
  shift: "ຍັງບໍ່ມີກະທີ່ເປີດ ກະລຸນາກວດສອບກະ",
  subscription: "ສິດການຂາຍຖືກລະງັບ ກະລຸນາກວດສອບແພັກເກດ",
  mode: "ຮ້ານ ຫຼື ສາຂານີ້ຍັງບໍ່ມີສິດຂາຍທົ່ວໄປ CUSTOM ຫຼື ສະແກນບາໂຄດ"
};

export function PosSalesAccessNotice({ reason, lang, generalSale = false }: {
  reason: PosSalesDenialReason; lang: string; generalSale?: boolean;
}) {
  const th = lang === "th";
  const lo = lang === "lo";
  const message = (th ? thai : lo ? lao : english)[reason];
  const retryPath = generalSale ? "/preview/pos/general" : "/preview/pos";
  // Fixed reason only, without tenant IDs, credentials or customer data.
  console.warn("[pos-sales-entry] access denied", { reason, path: retryPath });
  return (
    <main className="flex min-h-0 h-full w-full items-center justify-center overflow-auto bg-slate-50 p-5 text-slate-900">
      <section role="alert" data-testid="pos-sales-access-notice" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-widest text-blue-700">CpiPOS · SALES ACCESS</p>
        <h1 className="mt-3 text-xl font-bold">{th ? "ยังไม่สามารถเข้าหน้าขายได้" : lo ? "ຍັງເຂົ້າໜ້າຂາຍບໍ່ໄດ້" : "Sales access unavailable"}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">{message}</p>
        <p className="mt-2 text-xs text-slate-500">{th ? "รหัสตรวจสอบ" : lo ? "ລະຫັດກວດສອບ" : "Support code"}: POS-SALES-{reason.toUpperCase()}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={retryPath + "?retry=1"} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white">{th ? "ตรวจสอบอีกครั้ง" : lo ? "ກວດສອບອີກຄັ້ງ" : "Retry"}</a>
          {generalSale ? <Link href="/preview/pos" prefetch={false} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold">{th ? "กลับหน้าขายหลัก" : lo ? "ກັບໜ້າຂາຍຫຼັກ" : "Main sales page"}</Link> : null}
          {reason === "shift" ? <Link href="/preview/pos/shift" prefetch={false} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold">{th ? "ตรวจสอบกะ" : lo ? "ກວດສອບກະ" : "Check shift"}</Link> : null}
        </div>
        <p className="mt-4 text-xs text-slate-500">{th ? "หากยังเข้าไม่ได้ โปรดแจ้งรหัสตรวจสอบแก่ฝ่าย IT โดยไม่ต้องส่งรหัสผ่าน" : lo ? "ຖ້າຍັງເຂົ້າບໍ່ໄດ້ ກະລຸນາແຈ້ງລະຫັດໃຫ້ IT" : "If access remains unavailable, share the support code with IT, not your password."}</p>
      </section>
    </main>
  );
}

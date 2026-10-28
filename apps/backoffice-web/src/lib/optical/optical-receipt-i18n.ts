import type {Language} from "@/lib/i18n";

/** Receipt vocabulary is independent of UI and honors the same pos_lang cookie. */
const labels={
 th:{
  depositTitle:"ใบเสร็จรับเงินมัดจำ",fullTitle:"ใบเสร็จชำระเต็มจำนวน",
  bill:"เลขบิล",receipt:"เลขที่ใบเสร็จ",date:"วันที่",cashier:"พนักงาน",customer:"ลูกค้า",
  items:"รายการ",qty:"จำนวน",price:"ราคา",total:"ยอดเต็ม",paid:"รับมัดจำสะสม",
  remainder:"ยอดค้างชำระ",due:"วันนัดรับ",payment:"วิธีรับเงินล่าสุด",
  cash:"เงินสด",bank:"โอนเงิน",barcode:"บาร์โค้ดใบสั่งงาน — สแกน ณ วันที่นัดรับ",
  scan:"สแกนเพื่อเรียกยอดค้างชำระ ไม่ใช่หลักฐานการจ่าย",
  completed:"ชำระเต็มแล้ว ไม่มีการเรียกเก็บยอดซ้ำ",receiptHeading:"ใบเสร็จ"
 },
 en:{
  depositTitle:"Deposit receipt",fullTitle:"Paid in full receipt",
  bill:"Bill No.",receipt:"Receipt No.",date:"Date",cashier:"Cashier",customer:"Customer",
  items:"Item",qty:"Qty",price:"Price",total:"Order total",paid:"Total received",
  remainder:"Balance due",due:"Pickup date",payment:"Latest payment",
  cash:"Cash",bank:"Bank transfer",barcode:"Work order barcode — scan on pickup",
  scan:"Scan to retrieve the balance. Not proof of payment.",
  completed:"Paid in full. No balance is due.",receiptHeading:"Receipt"
 },
 lo:{
  depositTitle:"ໃບຮັບເງິນມັດຈຳ",fullTitle:"ໃບຮັບເງິນຄົບຈຳນວນ",
  bill:"ເລກບິນ",receipt:"ເລກໃບຮັບເງິນ",date:"ວັນທີ",cashier:"ພະນັກງານ",customer:"ລູກຄ້າ",
  items:"ລາຍການ",qty:"ຈຳນວນ",price:"ລາຄາ",total:"ຍອດລວມ",paid:"ຮັບເງິນແລ້ວ",
  remainder:"ຍອດຄ້າງຊຳລະ",due:"ວັນນັດຮັບ",payment:"ວິທີຊຳລະຫຼ້າສຸດ",
  cash:"ເງິນສົດ",bank:"ໂອນເງິນ",barcode:"ບາໂຄດໃບສັ່ງງານ — ສະແກນເມື່ອມາຮັບ",
  scan:"ສະແກນເພື່ອເບິ່ງຍອດຄ້າງ ບໍ່ແມ່ນຫຼັກຖານການຈ່າຍ",
  completed:"ຊຳລະຄົບແລ້ວ ບໍ່ມີຍອດຄ້າງ",receiptHeading:"ໃບຮັບເງິນ"
 }
} as const;
export type OpticalReceiptLabels=typeof labels.th | typeof labels.en | typeof labels.lo;
export function opticalReceiptLabels(lang:Language):OpticalReceiptLabels {return labels[lang]??labels.th;}
export function opticalReceiptDate(date:string,lang:Language){
 const parsed=new Date(date);
 if(!Number.isFinite(parsed.valueOf()))return date;
 const locale=lang==="lo"?"lo-LA":lang==="en"?"en-GB":"th-TH";
 return new Intl.DateTimeFormat(locale,{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(parsed);
}

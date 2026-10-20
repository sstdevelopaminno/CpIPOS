/** Optical CUSTOMER / WORK ORDER UI labels. Values from tenant data remain untranslated. */
import type {Language} from "@/lib/i18n";
const dictionary: Readonly<Record<string,{en:string;lo:string}>> = {
  "รายละเอียดใบสั่งงาน": {
    "en": "Work order details",
    "lo": "ລາຍລະອຽດໃບສັ່ງງານ"
  },
  "ตรวจสอบสินค้า การรับเงิน และกำหนดวันนัดรับ": {
    "en": "Review items, payments and pickup date",
    "lo": "ກວດສອບສິນຄ້າ ການຮັບເງິນ ແລະ ວັນນັດຮັບ"
  },
  "ปิด": {
    "en": "Close",
    "lo": "ປິດ"
  },
  "กำลังโหลดใบสั่งงาน...": {
    "en": "Loading work order...",
    "lo": "ກຳລັງໂຫຼດໃບສັ່ງງານ..."
  },
  "สถานะ": {
    "en": "Status",
    "lo": "ສະຖານະ"
  },
  "ยอดรวม": {
    "en": "Total",
    "lo": "ຍອດລວມ"
  },
  "รับเงินแล้ว": {
    "en": "Paid",
    "lo": "ຮັບເງິນແລ້ວ"
  },
  "ค้างชำระ": {
    "en": "Balance due",
    "lo": "ຍອດຄ້າງຊຳລະ"
  },
  "วันที่รับงาน": {
    "en": "Order received",
    "lo": "ວັນທີຮັບງານ"
  },
  "วันนัดรับ": {
    "en": "Pickup date",
    "lo": "ວັນນັດຮັບ"
  },
  "ยังไม่กำหนด": {
    "en": "Not set",
    "lo": "ຍັງບໍ່ໄດ້ກຳນົດ"
  },
  "รับงานแล้ว": {
    "en": "Received",
    "lo": "ຮັບງານແລ້ວ"
  },
  "สั่งเลนส์": {
    "en": "Lenses ordered",
    "lo": "ສັ່ງເລນແລ້ວ"
  },
  "ประกอบแว่น": {
    "en": "Assembling",
    "lo": "ກຳລັງປະກອບແວ່ນ"
  },
  "พร้อมรับ": {
    "en": "Ready for pickup",
    "lo": "ພ້ອມຮັບ"
  },
  "ส่งมอบแล้ว": {
    "en": "Collected",
    "lo": "ສົ່ງມອບແລ້ວ"
  },
  "ยกเลิก": {
    "en": "Cancel",
    "lo": "ຍົກເລີກ"
  },
  "รายการสินค้า": {
    "en": "Items",
    "lo": "ລາຍການສິນຄ້າ"
  },
  "สินค้า": {
    "en": "Product",
    "lo": "ສິນຄ້າ"
  },
  "ชิ้น": {
    "en": "pcs",
    "lo": "ອັນ"
  },
  "ไม่พบรายการสินค้า": {
    "en": "No items found",
    "lo": "ບໍ່ພົບລາຍການສິນຄ້າ"
  },
  "ประวัติการรับเงิน": {
    "en": "Payment history",
    "lo": "ປະຫວັດການຮັບເງິນ"
  },
  "เงินสด": {
    "en": "Cash",
    "lo": "ເງິນສົດ"
  },
  "เงินโอน": {
    "en": "Bank transfer",
    "lo": "ໂອນເງິນ"
  },
  "ยังไม่ได้เปิดสิทธิ์ข้อมูลการเงิน": {
    "en": "Finance data access is not enabled",
    "lo": "ຍັງບໍ່ເປີດສິດເຂົ້າເຖິງຂໍ້ມູນການເງິນ"
  },
  "ยังไม่มีประวัติรับเงิน": {
    "en": "No payments recorded",
    "lo": "ຍັງບໍ່ມີປະຫວັດຮັບເງິນ"
  },
  "พิมพ์ใบสั่งงานพร้อมบาร์โค้ด": {
    "en": "Print work order with barcode",
    "lo": "ພິມໃບສັ່ງງານພ້ອມບາໂຄດ"
  },
  "ใช้เครื่องพิมพ์": {
    "en": "Printer",
    "lo": "ໃຊ້ເຄື່ອງພິມ"
  },
  "ใบเสร็จ": {
    "en": "Receipt",
    "lo": "ໃບຮັບເງິນ"
  },
  "ตามการตั้งค่าสาขา": {
    "en": "using branch settings",
    "lo": "ຕາມການຕັ້ງຄ່າສາຂາ"
  },
  "ใช้การตั้งค่าเครื่องพิมพ์ของสาขา (58/80 mm)": {
    "en": "Uses branch receipt printer settings (58/80 mm)",
    "lo": "ໃຊ້ການຕັ້ງຄ່າເຄື່ອງພິມຂອງສາຂາ (58/80 mm)"
  },
  "ดูตัวอย่างใบงาน": {
    "en": "Preview work order",
    "lo": "ເບິ່ງຕົວຢ່າງໃບສັ່ງງານ"
  },
  "กำลังส่งคิวพิมพ์...": {
    "en": "Sending to print queue...",
    "lo": "ກຳລັງສົ່ງເຂົ້າຄິວພິມ..."
  },
  "พิมพ์ตามการตั้งค่าเครื่องพิมพ์": {
    "en": "Print using configured printer",
    "lo": "ພິມຕາມການຕັ້ງຄ່າເຄື່ອງພິມ"
  },
  "ยังไม่พบเครื่องพิมพ์ใบเสร็จสำหรับสาขา กรุณาตั้งค่าที่เมนูตั้งค่าเครื่องพิมพ์ ก่อนกดพิมพ์โดยตรง": {
    "en": "No receipt printer configured for this branch. Configure one in Printer Settings before direct printing.",
    "lo": "ຍັງບໍ່ມີເຄື່ອງພິມໃບຮັບເງິນໃນສາຂາ ກະລຸນາຕັ້ງຄ່າທີ່ເມນູເຄື່ອງພິມກ່ອນ"
  },
  "การเปลี่ยนวันนัดรับไม่แก้รายการสินค้า ยอดขาย หรือประวัติเงินมัดจำเดิม การยกเลิกงานที่รับเงินแล้วต้องผ่านกระบวนการคืนเงิน": {
    "en": "Changing the pickup date does not alter items, totals or deposits. Paid orders require a verified refund before cancellation.",
    "lo": "ການປ່ຽນວັນນັດຮັບບໍ່ປ່ຽນສິນຄ້າ ຍອດຂາຍ ຫຼື ເງິນມັດຈຳ ການຍົກເລີກງານທີ່ຮັບເງິນແລ້ວຕ້ອງຄືນເງິນຢ່າງຖືກຕ້ອງ"
  },
  "ยกเลิกใบงาน": {
    "en": "Cancel work order",
    "lo": "ຍົກເລີກໃບສັ່ງງານ"
  },
  "ใส่วันนัดรับ": {
    "en": "Set pickup date",
    "lo": "ໃສ່ວັນນັດຮັບ"
  },
  "ยืนยันยกเลิกใบงาน": {
    "en": "Confirm cancellation",
    "lo": "ຢືນຢັນຍົກເລີກໃບສັ່ງງານ"
  },
  "ใช้ PIN ผู้จัดการหรือเจ้าของร้าน เพื่อยืนยันการดำเนินการ": {
    "en": "Enter the manager or owner PIN to confirm.",
    "lo": "ໃສ່ລະຫັດ PIN ຜູ້ຈັດການ ຫຼື ເຈົ້າຂອງຮ້ານເພື່ອຢືນຢັນ"
  },
  "วันนัดรับแว่น *": {
    "en": "Glasses pickup date *",
    "lo": "ວັນນັດຮັບແວ່ນ *"
  },
  "หมายเหตุ": {
    "en": "Notes",
    "lo": "ໝາຍເຫດ"
  },
  "ยกเลิกใบงานที่ยังไม่มีการรับเงิน และคืนสต๊อกจองตามธุรกรรมเท่านั้น": {
    "en": "Cancel unpaid work orders only; reserved inventory is released through the recorded transaction.",
    "lo": "ຍົກເລີກໄດ້ສະເພາະໃບສັ່ງງານທີ່ຍັງບໍ່ຮັບເງິນ ສະຕັອກຈອງຈະຖືກຄືນຕາມທຸລະກຳ"
  },
  "PIN ผู้จัดการหรือเจ้าของร้าน *": {
    "en": "Manager or owner PIN *",
    "lo": "PIN ຜູ້ຈັດການ ຫຼື ເຈົ້າຂອງຮ້ານ *"
  },
  "กำลังบันทึก...": {
    "en": "Saving...",
    "lo": "ກຳລັງບັນທຶກ..."
  },
  "บันทึกวันนัดรับ": {
    "en": "Save pickup date",
    "lo": "ບັນທຶກວັນນັດຮັບ"
  },
  "กรุณากรอก PIN ผู้จัดการหรือเจ้าของร้านให้ถูกต้อง": {
    "en": "Enter a valid manager or owner PIN.",
    "lo": "ກະລຸນາໃສ່ PIN ຜູ້ຈັດການ ຫຼື ເຈົ້າຂອງຮ້ານໃຫ້ຖືກຕ້ອງ"
  },
  "กรุณาระบุวันนัดรับให้ถูกต้อง ตั้งแต่วันนี้เป็นต้นไป": {
    "en": "Choose a valid pickup date, today or later.",
    "lo": "ກະລຸນາເລືອກວັນນັດຮັບໃຫ້ຖືກຕ້ອງ ຕັ້ງແຕ່ມື້ນີ້ເປັນຕົ້ນໄປ"
  },
  "ใบงานมีเงินรับแล้ว ต้องทำรายการคืนเงินที่ตรวจสอบได้ก่อนยกเลิก": {
    "en": "This work order has a payment. Complete a verifiable refund before cancellation.",
    "lo": "ໃບສັ່ງງານນີ້ມີການຮັບເງິນແລ້ວ ຕ້ອງຄືນເງິນກ່ອນຍົກເລີກ"
  },
  "ยืนยันยกเลิกใบงาน โดยใช้ PIN ผู้จัดการหรือเจ้าของร้าน?": {
    "en": "Cancel this work order using a manager or owner PIN?",
    "lo": "ຢືນຢັນຍົກເລີກໃບສັ່ງງານດ້ວຍ PIN ຜູ້ຈັດການ ຫຼື ເຈົ້າຂອງຮ້ານ?"
  },
  "ดำเนินการไม่สำเร็จ": {
    "en": "Operation failed",
    "lo": "ດຳເນີນການບໍ່ສຳເລັດ"
  },
  "บันทึกไม่สำเร็จ": {
    "en": "Could not save",
    "lo": "ບັນທຶກບໍ່ສຳເລັດ"
  },
  "ยังไม่ได้กำหนดเครื่องพิมพ์ใบเสร็จในเมนูตั้งค่าเครื่องพิมพ์ของสาขา": {
    "en": "No branch receipt printer has been configured.",
    "lo": "ສາຂານີ້ຍັງບໍ່ໄດ້ຕັ້ງຄ່າເຄື່ອງພິມໃບຮັບເງິນ"
  },
  "ส่งคิวพิมพ์ไม่สำเร็จ": {
    "en": "Unable to queue print",
    "lo": "ສົ່ງເຂົ້າຄິວພິມບໍ່ສຳເລັດ"
  },
  "ไม่สามารถส่งงานพิมพ์": {
    "en": "Unable to print",
    "lo": "ບໍ່ສາມາດພິມໄດ້"
  },
  "ไม่สามารถโหลดรายละเอียดใบสั่งงาน": {
    "en": "Unable to load work order details",
    "lo": "ບໍ່ສາມາດໂຫຼດລາຍລະອຽດໃບສັ່ງງານ"
  },
  "โหลดใบงานไม่สำเร็จ": {
    "en": "Unable to load work order",
    "lo": "ໂຫຼດໃບສັ່ງງານບໍ່ສຳເລັດ"
  },
  "รายละเอียดลูกค้าแว่นตา": {
    "en": "Optical customer details",
    "lo": "ລາຍລະອຽດລູກຄ້າແວ່ນຕາ"
  },
  "รหัสลูกค้า": {
    "en": "Customer code",
    "lo": "ລະຫັດລູກຄ້າ"
  },
  "ชื่อ–นามสกุล": {
    "en": "Full name",
    "lo": "ຊື່–ນາມສະກຸນ"
  },
  "โทรศัพท์": {
    "en": "Phone",
    "lo": "ເບີໂທ"
  },
  "อายุ": {
    "en": "Age",
    "lo": "ອາຍຸ"
  },
  "วันที่ตรวจล่าสุด": {
    "en": "Last eye exam",
    "lo": "ວັນກວດສາຍຕາຫຼ້າສຸດ"
  },
  "ผู้ตรวจ": {
    "en": "Examiner",
    "lo": "ຜູ້ກວດ"
  },
  "อายุ (ปี)": {
    "en": "Age (years)",
    "lo": "ອາຍຸ (ປີ)"
  },
  "ค่าสายตาเดิม (ข้อความ)": {
    "en": "Previous prescription (text)",
    "lo": "ຄ່າສາຍຕາເກົ່າ (ຂໍ້ຄວາມ)"
  },
  "แก้ไขเฉพาะข้อมูลลูกค้า ผลตรวจเก่าจะไม่ถูกเขียนทับ": {
    "en": "Only customer information is edited; existing eye exams are preserved.",
    "lo": "ແກ້ໄຂສະເພາະຂໍ້ມູນລູກຄ້າ ຜົນກວດເກົ່າຈະຖືກເກັບໄວ້"
  },
  "บันทึกการแก้ไข": {
    "en": "Save changes",
    "lo": "ບັນທຶກການແກ້ໄຂ"
  },
  "แก้ไขข้อมูลลูกค้า": {
    "en": "Edit customer",
    "lo": "ແກ້ໄຂຂໍ້ມູນລູກຄ້າ"
  },
  "ยกเลิกแก้ไข": {
    "en": "Discard changes",
    "lo": "ຍົກເລີກການແກ້ໄຂ"
  },
  "ลบ (เก็บถาวร)": {
    "en": "Archive customer",
    "lo": "ລຶບ (ເກັບຖາວອນ)"
  },
  "ประวัติตรวจสายตา": {
    "en": "Eye examination history",
    "lo": "ປະຫວັດກວດສາຍຕາ"
  },
  "รายการ": {
    "en": "records",
    "lo": "ລາຍການ"
  },
  "วันที่": {
    "en": "Date",
    "lo": "ວັນທີ"
  },
  "ยังไม่มีผลตรวจ": {
    "en": "No eye exams recorded",
    "lo": "ຍັງບໍ່ມີຜົນກວດ"
  },
  "กำลังโหลดข้อมูลลูกค้า...": {
    "en": "Loading customer...",
    "lo": "ກຳລັງໂຫຼດຂໍ້ມູນລູກຄ້າ..."
  },
  "ไม่สามารถอ่านรายละเอียดลูกค้า": {
    "en": "Unable to read customer details",
    "lo": "ບໍ່ສາມາດອ່ານລາຍລະອຽດລູກຄ້າ"
  },
  "อ่านรายละเอียดลูกค้าไม่สำเร็จ": {
    "en": "Unable to load customer details",
    "lo": "ໂຫຼດລາຍລະອຽດລູກຄ້າບໍ່ສຳເລັດ"
  },
  "กรุณาระบุชื่อและอายุที่ถูกต้อง (0–130 ปี)": {
    "en": "Enter a valid name and age (0–130 years).",
    "lo": "ກະລຸນາໃສ່ຊື່ ແລະ ອາຍຸໃຫ້ຖືກຕ້ອງ (0–130 ປີ)"
  },
  "ย้ายลูกค้าเข้าประวัติเก็บถาวร? ข้อมูลผลตรวจจะไม่ถูกลบ": {
    "en": "Archive customer? Existing eye exams will not be deleted.",
    "lo": "ຍ້າຍລູກຄ້າເຂົ້າປະຫວັດຖາວອນ? ຜົນກວດຈະບໍ່ຖືກລຶບ"
  },
  "เก็บถาวรไม่สำเร็จ": {
    "en": "Unable to archive customer",
    "lo": "ບໍ່ສາມາດເກັບຖາວອນໄດ້"
  },
  "เลขใบงาน": {
    "en": "Order number",
    "lo": "ເລກໃບສັ່ງງານ"
  },
  "ลูกค้า": {
    "en": "Customer",
    "lo": "ລູກຄ້າ"
  },
  "ยอดรวม (LAK)": {
    "en": "Total (LAK)",
    "lo": "ຍອດລວມ (LAK)"
  },
  "มัดจำ/ชำระแล้ว": {
    "en": "Deposit / paid",
    "lo": "ມັດຈຳ / ຊຳລະແລ້ວ"
  },
  "นัดรับ": {
    "en": "Pickup",
    "lo": "ນັດຮັບ"
  },
  "จัดการ": {
    "en": "Actions",
    "lo": "ຈັດການ"
  },
  "ดู / แก้ไข / ลบ": {
    "en": "View / Edit / Cancel",
    "lo": "ເບິ່ງ / ແກ້ໄຂ / ຍົກເລີກ"
  },
  "กำลังโหลด...": {
    "en": "Loading...",
    "lo": "ກຳລັງໂຫຼດ..."
  },
  "ดู / แก้ไข / ลบลูกค้า": {
    "en": "View / Edit / Archive",
    "lo": "ເບິ່ງ / ແກ້ໄຂ / ເກັບຖາວອນ"
  }
};
export function opticalDetailText(lang:Language,thai:string):string {
 if(lang==="th")return thai;
 return dictionary[thai]?.[lang]??thai;
}
export function opticalDetailStatus(lang:Language,status:string):string {
 const statuses:Record<string,string>={received:"รับงานแล้ว",lens_ordered:"สั่งเลนส์",edging:"ประกอบแว่น",ready_for_pickup:"พร้อมรับ",collected:"ส่งมอบแล้ว",cancelled:"ยกเลิก"};
 return opticalDetailText(lang,statuses[status]??status);
}
export function opticalDetailDate(lang:Language,date:string,includeTime=false):string {
 const time=new Date(date);
 if(!Number.isFinite(time.valueOf()))return date;
 return new Intl.DateTimeFormat(lang==="lo"?"lo-LA":lang==="en"?"en-GB":"th-TH",{
  timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",
  ...(includeTime?{hour:"2-digit" as const,minute:"2-digit" as const}:{}),
 }).format(time);
}

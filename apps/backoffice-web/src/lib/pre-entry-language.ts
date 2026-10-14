import type { AppLanguage } from "@/lib/app-language-client";

/** Literal, user-facing messages for the branch and device steps of POS sign-in.
 * Backend codes, branch/device names and PIN values are never translated.
 */
const copy: Record<string, {en: string; lo: string}> = {
  "หมดเวลาการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง": {en:"Connection timed out. Please try again.",lo:"ໝົດເວລາເຊື່ອມຕໍ່ ກະລຸນາລອງໃໝ່"},
  "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้": {en:"Cannot connect to server.",lo:"ບໍ່ສາມາດເຊື່ອມຕໍ່ເຊີບເວີໄດ້"},
  "ไม่พบรายการสาขาที่ใช้งานได้": {en:"No available branches found.",lo:"ບໍ່ພົບສາຂາທີ່ພ້ອມໃຊ້ງານ"},
  "กรุณาเลือกสาขา": {en:"Please select a branch.",lo:"ກະລຸນາເລືອກສາຂາ"},
  "สาขาที่เลือกไม่ถูกต้อง กรุณาเลือกใหม่": {en:"Invalid branch. Please select again.",lo:"ສາຂາທີ່ເລືອກບໍ່ຖືກຕ້ອງ ກະລຸນາເລືອກໃໝ່"},
  "กำลังเข้าสู่ระบบ...": {en:"Logging in...",lo:"ກຳລັງເຂົ້າລະບົບ..."},
  "ไม่สามารถเลือกสาขาได้": {en:"Unable to select branch.",lo:"ບໍ່ສາມາດເລືອກສາຂາໄດ້"},
  "กำลังโหลดรายการสาขา...": {en:"Loading branches...",lo:"ກຳລັງໂຫຼດລາຍການສາຂາ..."},
  "เลือกสาขา": {en:"Select a branch",lo:"ເລືອກສາຂາ"},
  "รหัสสาขา": {en:"Branch code",lo:"ລະຫັດສາຂາ"},
  "ออกจากระบบ": {en:"Log out",lo:"ອອກຈາກລະບົບ"},
  "กำลังบันทึก...": {en:"Saving...",lo:"ກຳລັງບັນທຶກ..."},
  "ถัดไป": {en:"Next",lo:"ຖັດໄປ"},
  "กำลังเข้าสู่ระบบ": {en:"Logging in",lo:"ກຳລັງເຂົ້າລະບົບ"},
  "ดำเนินการไม่สำเร็จ": {en:"Action failed",lo:"ດຳເນີນການບໍ່ສຳເລັດ"},
  "ปิด": {en:"Close",lo:"ປິດ"},
  "กรุณาเลือกเครื่องแคชเชียร์": {en:"Please select a cashier terminal.",lo:"ກະລຸນາເລືອກເຄື່ອງແຄຊເຊຍ"},
  "กรุณายืนยันผู้ใช้งานก่อนเลือกเครื่อง": {en:"Verify an employee before selecting a terminal.",lo:"ກະລຸນາຢືນຢັນພະນັກງານກ່ອນເລືອກເຄື່ອງ"},
  "แพ็กเกจปัจจุบันยังไม่รองรับการเข้าใช้งานหน้าขาย": {en:"This package does not include POS sales access.",lo:"ແພັກເກດນີ້ຍັງບໍ່ຮອງຮັບການຂາຍຜ່ານ POS"},
  "ไม่พบเครื่องที่เลือกในสาขานี้": {en:"Terminal not found in this branch.",lo:"ບໍ່ພົບເຄື່ອງທີ່ເລືອກໃນສາຂານີ້"},
  "เครื่องที่เลือกถูกปิดใช้งาน": {en:"Selected terminal is disabled.",lo:"ເຄື່ອງທີ່ເລືອກຖືກປິດໃຊ້ງານ"},
  "เครื่องที่เลือกออฟไลน์หรืออยู่ระหว่างบำรุงรักษา": {en:"Terminal is offline or under maintenance.",lo:"ເຄື່ອງອອບລາຍ ຫຼືກຳລັງບຳລຸງຮັກສາ"},
  "เครื่องนี้ยังมีผู้ใช้งานค้างอยู่ พนักงานขายต้องเลือกเครื่องอื่น หรือให้ผู้จัดการ/เจ้าของร้านเข้าแทน": {en:"This terminal is occupied. Choose another or ask a manager/owner.",lo:"ເຄື່ອງນີ້ກຳລັງມີຜູ້ໃຊ້ ກະລຸນາເລືອກເຄື່ອງອື່ນ ຫຼືຕິດຕໍ່ຜູ້ຈັດການ"},
  "ผู้ใช้งานนี้ไม่ได้รับสิทธิ์ใช้เครื่องที่เลือก": {en:"You do not have access to this terminal.",lo:"ທ່ານບໍ່ມີສິດໃຊ້ເຄື່ອງນີ້"},
  "เครื่องนี้กำลังถูกใช้งานอยู่": {en:"Terminal is currently in use.",lo:"ເຄື່ອງນີ້ກຳລັງຖືກໃຊ້ງານ"},
  "ไม่สามารถเตรียมบริบทการล็อคอินได้": {en:"Unable to prepare login context.",lo:"ບໍ່ສາມາດກະກຽມຂໍ້ມູນເຂົ້າລະບົບ"},
  "ไม่สามารถสร้าง POS Session ได้": {en:"Unable to create POS session.",lo:"ບໍ່ສາມາດສ້າງ POS Session"},
  "ระบบตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง": {en:"The server is slow. Please retry.",lo:"ເຊີບເວີຕອບສະໜອງຊ້າ ກະລຸນາລອງໃໝ່"},
  "ไม่สามารถเข้าใช้งานเครื่องที่เลือกได้": {en:"Unable to open selected terminal.",lo:"ບໍ່ສາມາດເປີດເຄື່ອງທີ່ເລືອກ"},
  "ไม่สามารถเลือกเครื่องได้ในขณะนี้": {en:"Unable to select a terminal right now.",lo:"ບໍ່ສາມາດເລືອກເຄື່ອງໄດ້ໃນຂະນະນີ້"},
  "ไม่พบเครื่องแคชเชียร์ที่ใช้งานได้ในสาขานี้": {en:"No available cashier terminals in this branch.",lo:"ບໍ່ພົບເຄື່ອງແຄຊເຊຍທີ່ພ້ອມໃຊ້ໃນສາຂານີ້"},
  "กำลังตรวจสอบและปลดล็อก session เครื่อง...": {en:"Verifying and unlocking terminal session...",lo:"ກຳລັງກວດສອບ ແລະປົດລັອກເຄື່ອງ..."},
  "ระบบยังประมวลผลอยู่ กรุณารอสักครู่...": {en:"Still processing. Please wait...",lo:"ລະບົບກຳລັງປະມວນຜົນ ກະລຸນາລໍຖ້າ..."},
  "เครื่องที่เลือกยังไม่พร้อมใช้งาน": {en:"Selected terminal is not ready.",lo:"ເຄື່ອງທີ່ເລືອກຍັງບໍ່ພ້ອມໃຊ້"},
  "กำลังปลดล็อกเครื่องที่กำลังใช้งาน...": {en:"Unlocking the occupied terminal...",lo:"ກຳລັງປົດລັອກເຄື່ອງທີ່ຖືກໃຊ້..."},
  "กำลังเปิดเครื่องแคชเชียร์...": {en:"Opening cashier terminal...",lo:"ກຳລັງເປີດເຄື່ອງແຄຊເຊຍ..."},
  "กำลังเปิดหน้าระบบขาย...": {en:"Opening POS sales screen...",lo:"ກຳລັງເປີດໜ້າຂາຍ POS..."},
  "โหมดร้านเดี่ยว: ไม่มีการเลือกสาขา": {en:"Single-store mode: no branch selection",lo:"ໂໝດຮ້ານດຽວ: ບໍ່ຕ້ອງເລືອກສາຂາ"},
  "สาขา": {en:"Branch",lo:"ສາຂາ"},
  "กำลังโหลดรายการเครื่องแคชเชียร์...": {en:"Loading cashier terminals...",lo:"ກຳລັງໂຫຼດເຄື່ອງແຄຊເຊຍ..."},
  "เลือกเครื่องแคชเชียร์": {en:"Select cashier terminal",lo:"ເລືອກເຄື່ອງແຄຊເຊຍ"},
  "รหัสเครื่อง": {en:"Terminal code",lo:"ລະຫັດເຄື່ອງ"},
  "กำลังใช้งานโดย": {en:"In use by",lo:"ກຳລັງໃຊ້ໂດຍ"},
  "พร้อมใช้งาน": {en:"Ready",lo:"ພ້ອມໃຊ້"},
  "กำลังใช้งาน": {en:"In use",lo:"ກຳລັງໃຊ້ງານ"},
  "ออฟไลน์": {en:"Offline",lo:"ອອບລາຍ"},
  "ปิดใช้งาน": {en:"Disabled",lo:"ປິດໃຊ້ງານ"},
  "ย้อนกลับ": {en:"Back",lo:"ກັບຄືນ"},
  "เปิดแคช": {en:"Open POS",lo:"ເປີດ POS"},
  "กำลังเปิดแคช": {en:"Opening POS",lo:"ກຳລັງເປີດ POS"}
};

export function loginFlowText(lang: AppLanguage, thai: string): string {
  return lang === "th" ? thai : copy[thai]?.[lang] ?? thai;
}

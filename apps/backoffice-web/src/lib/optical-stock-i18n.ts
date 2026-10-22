/** CUSTOM Optical inventory: localized copy only. Business values and SKU never translated. */
import type {Language} from "@/lib/i18n";
const copy:Readonly<Record<string,readonly [string,string]>>={
  "ดูสรุปสต๊อก": ["Stock summary","ສະຫຼຸບສະຕັອກ"],
  "สแกนเพิ่ม/ลดสต๊อก": ["Scan to receive / issue","ສະແກນຮັບ/ຈ່າຍສະຕັອກ"],
  "สแกนบาร์โค้ดเพื่อเพิ่ม/ลดสต๊อก": ["Scan barcode to receive / issue stock","ສະແກນບາໂຄດເພື່ອຮັບ/ຈ່າຍສະຕັອກ"],
  "สรุปจำนวนสินค้าในสต๊อก": ["Inventory summary","ສະຫຼຸບຈຳນວນສິນຄ້າ"],
  "SKU / บาร์โค้ดสินค้า": ["Product SKU / barcode","SKU / ບາໂຄດສິນຄ້າ"],
  "ยิงบาร์โค้ดหรือกรอกรหัสสินค้า": ["Scan barcode or enter SKU","ສະແກນບາໂຄດ ຫຼື ປ້ອນ SKU"],
  "ค้นหาจากบาร์โค้ด": ["Find barcode","ຄົ້ນຫາຈາກບາໂຄດ"],
  "ผลการค้นหาสินค้า": ["Product search results","ຜົນຄົ້ນຫາສິນຄ້າ"],
  "กรุณากรอกหรือยิงบาร์โค้ดสินค้า": ["Enter or scan a product barcode","ກະລຸນາປ້ອນ ຫຼື ສະແກນບາໂຄດ"],
  "กรุณาระบุ SKU / บาร์โค้ดสินค้าที่ถูกต้อง": ["Enter a valid SKU / barcode","ກະລຸນາປ້ອນ SKU / ບາໂຄດທີ່ຖືກຕ້ອງ"],
  "จำนวนต้องเป็นจำนวนเต็มบวกตั้งแต่ 1 ถึง 100,000 ชิ้น": ["Quantity must be a positive whole number from 1 to 100,000","ຈຳນວນຕ້ອງເປັນຈຳນວນເຕັມ 1–100,000"],
  "กรุณาระบุเหตุผลในการปรับสต๊อก": ["Enter a reason for the stock adjustment","ກະລຸນາໃສ່ເຫດຜົນການປັບສະຕັອກ"],
  "เหตุผลในการปรับสต๊อกต้องมีอย่างน้อย 3 ตัวอักษร": ["The reason must contain at least 3 characters","ເຫດຜົນຕ້ອງມີຢ່າງໜ້ອຍ 3 ຕົວອັກສອນ"],
  "เหตุผลในการปรับสต๊อกต้องไม่เกิน 300 ตัวอักษร": ["Reason must not exceed 300 characters","ເຫດຜົນຕ້ອງບໍ່ເກີນ 300 ຕົວອັກສອນ"],
  "เลือกเหตุผลอย่างรวดเร็ว (หรือพิมพ์เอง)": ["Choose a reason or type your own","ເລືອກເຫດຜົນ ຫຼື ພິມເອງ"],
  "รับสินค้าตามใบส่งของ": ["Received from delivery note","ຮັບສິນຄ້າຕາມໃບສົ່ງ"],
  "รับสินค้าเข้าใหม่": ["New stock received","ຮັບສິນຄ້າໃໝ່"],
  "ปรับยอดจากผลตรวจนับ": ["Adjusted after stock count","ປັບຍອດຈາກການນັບສະຕັອກ"],
  "เบิกใช้ภายในร้าน": ["Issued for store use","ເບີກໃຊ້ໃນຮ້ານ"],
  "สินค้าชำรุด": ["Damaged stock","ສິນຄ້າເສຍຫາຍ"],
  "จำนวนรับเข้าเริ่มต้นต้องเป็นจำนวนเต็มบวก 1–100,000 ชิ้น": ["Initial receipt must be a positive whole number from 1 to 100,000","ຈຳນວນຮັບເຂົ້າຕ້ອງເປັນຈຳນວນເຕັມ 1–100,000"],
  "กรอบแว่น": [
    "Frames",
    "ຂອບແວ່ນ"
  ],
  "เลนส์": [
    "Lenses",
    "ເລນ"
  ],
  "อุปกรณ์เสริม": [
    "Accessories",
    "ອຸປະກອນເສີມ"
  ],
  "ชิ้น": [
    "pcs",
    "ຊິ້ນ"
  ],
  "สินค้า": [
    "Products",
    "ສິນຄ້າ"
  ],
  "เหลือ 1": [
    "1 left",
    "ເຫຼືອ 1"
  ],
  "หมด": [
    "Out of stock",
    "ໝົດ"
  ],
  "ยังไม่มีรายการรับเข้าสต๊อก": ["No recorded stock receipt","ຍັງບໍ່ມີລາຍການຮັບສະຕັອກ"],
  "ยังไม่บันทึกจำนวนรับเข้าสต๊อก ไม่ใช่ยอดคงเหลือ 0": ["Stock receipt not recorded (not zero inventory)","ຍັງບໍ່ບັນທຶກການຮັບສະຕັອກ (ບໍ່ແມ່ນຍອດ 0)"],
  "กรอกหรือสแกนบาร์โค้ดได้ · การสร้าง/แก้สินค้าไม่ใช่การรับสต๊อก · ต้องบันทึกจำนวนรับเข้าแยกด้วยรายการตรวจสอบ": ["Enter or scan barcode. Catalog changes do not receive stock; quantities require a separate audited receipt.","ປ້ອນ ຫຼື ສະແກນບາໂຄດ · ການແກ້ສິນຄ້າບໍ່ແມ່ນການຮັບສະຕັອກ"],
  "SKU / บาร์โค้ด (กรอกหรือสแกน) *": ["SKU / Barcode (enter or scan) *","SKU / ບາໂຄດ (ປ້ອນ ຫຼື ສະແກນ) *"],
  "กรอกหรือสแกน": ["Enter or scan","ປ້ອນ ຫຼື ສະແກນ"],
  "สแกนเพื่อปรับสต๊อก": ["Scan stock barcode","ສະແກນບາໂຄດສະຕັອກ"],
  "สแกนบาร์โค้ดเพื่อเพิ่ม/ลดจำนวน": ["Scan barcode to receive / issue stock","ສະແກນບາໂຄດເພື່ອຮັບ/ຈ່າຍສະຕັອກ"],
  "ยิงบาร์โค้ด แล้วกด Enter": ["Scan barcode and press Enter","ສະແກນບາໂຄດແລ້ວກົດ Enter"],
  "+ เพิ่ม/ลดสต๊อก": ["+ Receive / issue stock","+ ຮັບ/ຈ່າຍສະຕັອກ"],
  "+/- สต๊อก": ["+/- Stock","+/- ສະຕັອກ"],
  "รับเข้า / เบิกออกสต๊อก Optical": ["Optical stock receive / issue","ຮັບ/ຈ່າຍສະຕັອກ Optical"],
  "รายการนี้บันทึกจำนวนสต๊อกจริง ไม่แก้ราคาขาย ไม่รับเงิน และไม่ตัดใบงานซ้ำ": ["This records physical inventory, not a sale, payment or work-order handover.","ລາຍການນີ້ບັນທຶກສະຕັອກ ບໍ່ແມ່ນຍອດຂາຍ"],
  "ประเภทการปรับจำนวน": ["Adjustment type","ປະເພດການປັບຈຳນວນ"],
  "เพิ่มจำนวน (รับสินค้าเข้า)": ["Receive (+)","ຮັບເຂົ້າ (+)"],
  "ลดจำนวน (เบิกสินค้าออกโดยผู้จัดการ)": ["Issue (-), manager authorized","ຈ່າຍອອກ (-)"],
  "จำนวนชิ้นที่ต้องการเพิ่ม/ลด *": ["Quantity to receive/issue *","ຈຳນວນທີ່ຈະຮັບ/ຈ່າຍ *"],
  "เหตุผล / เอกสารอ้างอิง *": ["Reason / reference *","ເຫດຜົນ / ເອກະສານອ້າງອີງ *"],
  "เช่น รับสินค้าตามใบส่งของ / ปรับจากผลตรวจนับ": ["E.g. supplier delivery note / physical count","ເຊັ່ນ ໃບສົ່ງສິນຄ້າ"],
  "ไม่พบ SKU / บาร์โค้ดในสาขานี้": ["SKU / barcode not found in this branch","ບໍ່ພົບ SKU / ບາໂຄດໃນສາຂານີ້"],
  "ระบุจำนวนเต็มบวก และเหตุผลอย่างน้อย 3 ตัวอักษร": ["Enter a positive integer quantity and reason (3+ characters)","ປ້ອນຈຳນວນເຕັມ ແລະ ເຫດຜົນ"],
  "ยืนยันปรับสต๊อก": ["Confirm stock adjustment","ຢືນຢັນປັບສະຕັອກ"],
  "จำนวนคงเหลือที่ยืนยันแล้ว": ["Verified available stock","ສະຕັອກທີ່ຢືນຢັນແລ້ວ"],
  "กดปรับจำนวนเพื่อรับสินค้าเข้าหรือเบิกออก โดยมีประวัติตรวจสอบ": ["Use stock adjustment to receive/issue with an audit trail","ປັບຈຳນວນພ້ອມປະຫວັດກວດສອບ"],
  "+/- ปรับจำนวนสต๊อก": ["+/- Adjust stock","+/- ປັບສະຕັອກ"],
  "จำนวนรับเข้าเริ่มต้น (จะเปิดหน้าต่างยืนยันสต๊อกแยก)": ["Initial received quantity (separate confirmation required)","ຈຳນວນຮັບເຂົ້າເບື້ອງຕົ້ນ"],
  "รอตรวจสต๊อก": [
    "Pending stock verification",
    "ລໍຖ້າກວດສະຕັອກ"
  ],
  "กลับเมนูเพิ่มเติม": [
    "Back to More",
    "ກັບເມນູເພີ່ມເຕີມ"
  ],
  "เลือกสาขาสต๊อก": [
    "Select stock branch",
    "ເລືອກສາຂາສະຕັອກ"
  ],
  "สลับประเภทสต๊อก Optical": [
    "Optical stock categories",
    "ປ່ຽນປະເພດສະຕັອກ Optical"
  ],
  "สต๊อกกรอบแว่น": [
    "Frame stock",
    "ສະຕັອກຂອບແວ່ນ"
  ],
  "สต๊อกเลนส์": [
    "Lens stock",
    "ສະຕັອກເລນ"
  ],
  "สต๊อกกรอบแว่นและเลนส์": [
    "Frames & lenses inventory",
    "ສະຕັອກຂອບແວ່ນ ແລະ ເລນ"
  ],
  "เลือกสาขา": [
    "Select branch",
    "ເລືອກສາຂາ"
  ],
  "★ สินค้าขายดี": [
    "★ Best sellers",
    "★ ສິນຄ້າຂາຍດີ"
  ],
  "+ เพิ่มสินค้า": [
    "+ Add product",
    "+ ເພີ່ມສິນຄ້າ"
  ],
  "+ สร้างสินค้าหลายรายการ": [
    "+ Add multiple products",
    "+ ເພີ່ມຫຼາຍສິນຄ້າ"
  ],
  "ค้นหารายการสินค้า": [
    "Search products",
    "ຄົ້ນຫາສິນຄ້າ"
  ],
  "ค้นหา ชื่อสินค้า / SKU / บาร์โค้ด": [
    "Search name / SKU / barcode",
    "ຄົ້ນຫາຊື່ສິນຄ້າ / SKU / ບາໂຄດ"
  ],
  "ประเภท": [
    "Type",
    "ປະເພດ"
  ],
  "ทุกประเภท": [
    "All types",
    "ທຸກປະເພດ"
  ],
  "สถานะ": [
    "Status",
    "ສະຖານະ"
  ],
  "ทั้งหมด": [
    "All",
    "ທັງໝົດ"
  ],
  "มีสินค้า": [
    "In stock",
    "ມີສິນຄ້າ"
  ],
  "รอยืนยัน": [
    "Unverified",
    "ລໍຢືນຢັນ"
  ],
  "ต่อหน้า": [
    "Per page",
    "ຕໍ່ໜ້າ"
  ],
  "รายการสต๊อก Optical": [
    "Optical stock entries",
    "ລາຍການສະຕັອກ Optical"
  ],
  "SKU / บาร์โค้ด": [
    "SKU / Barcode",
    "SKU / ບາໂຄດ"
  ],
  "รูปสินค้า": [
    "Product image",
    "ຮູບສິນຄ້າ"
  ],
  "แบรนด์": [
    "Brand",
    "ຍີ່ຫໍ້"
  ],
  "รุ่น": [
    "Model",
    "ຮຸ່ນ"
  ],
  "สี": [
    "Color",
    "ສີ"
  ],
  "ขนาด": [
    "Size",
    "ຂະໜາດ"
  ],
  "ยี่ห้อ": [
    "Brand",
    "ຍີ່ຫໍ້"
  ],
  "ชื่อเลนส์": [
    "Lens name",
    "ຊື່ເລນ"
  ],
  "ค่าสายตา": [
    "Prescription",
    "ຄ່າສາຍຕາ"
  ],
  "ชื่อสินค้า": [
    "Product name",
    "ຊື່ສິນຄ້າ"
  ],
  "รายละเอียด": [
    "Details",
    "ລາຍລະອຽດ"
  ],
  "หน่วย": [
    "Unit",
    "ຫົວໜ່ວຍ"
  ],
  "ราคา (": [
    "Price (",
    "ລາຄາ ("
  ],
  "จำนวน": [
    "Quantity",
    "ຈຳນວນ"
  ],
  "จำนวนคงเหลือ": [
    "Available",
    "ຄົງເຫຼືອ"
  ],
  "จัดการ": [
    "Manage",
    "ຈັດການ"
  ],
  "ดูรหัส": [
    "View SKU",
    "ເບິ່ງ SKU"
  ],
  "ดูหรืออัปโหลดรูปสินค้า": [
    "View/upload product image",
    "ເບິ່ງ/ອັບໂຫຼດຮູບສິນຄ້າ"
  ],
  "+ รูป": [
    "+ Image",
    "+ ຮູບ"
  ],
  "ยังไม่รับรองยอด Optical": [
    "Optical quantity not verified",
    "ຍອດ Optical ຍັງບໍ່ຢືນຢັນ"
  ],
  "แก้ไข": [
    "Edit",
    "ແກ້ໄຂ"
  ],
  "ลบ": [
    "Delete",
    "ລຶບ"
  ],
  "ไม่พบสินค้าที่ตรงกับประเภทหรือเงื่อนไขค้นหา": [
    "No matching products",
    "ບໍ່ພົບສິນຄ້າທີ່ກົງກັບການຄົ້ນຫາ"
  ],
  "ก่อนหน้า": [
    "Previous",
    "ກ່ອນໜ້າ"
  ],
  "ถัดไป": [
    "Next",
    "ຖັດໄປ"
  ],
  "แบ่งหน้าสินค้า": [
    "Product pages",
    "ໜ້າລາຍການສິນຄ້າ"
  ],
  "เพิ่มสินค้า": [
    "Add product",
    "ເພີ່ມສິນຄ້າ"
  ],
  "แก้ไขสินค้า": [
    "Edit product",
    "ແກ້ໄຂສິນຄ້າ"
  ],
  "สร้างสินค้าหลายรายการ": [
    "Create multiple products",
    "ສ້າງຫຼາຍສິນຄ້າ"
  ],
  "จัดการรูปสินค้า": [
    "Manage images",
    "ຈັດການຮູບສິນຄ້າ"
  ],
  "สินค้าขายดี 30 วันย้อนหลัง": [
    "Best sellers · last 30 days",
    "ສິນຄ້າຂາຍດີ 30 ວັນ"
  ],
  "ยืนยันการลบสินค้า": [
    "Confirm delete",
    "ຢືນຢັນລຶບສິນຄ້າ"
  ],
  "ปิด": [
    "Close",
    "ປິດ"
  ],
  "SKU / บาร์โค้ด กรอกเองได้ · ไม่เปลี่ยนจำนวนสต๊อกอัตโนมัติ": [
    "Enter SKU/barcode manually · stock is not adjusted automatically",
    "ປ້ອນ SKU/ບາໂຄດເອງ · ບໍ່ປ່ຽນຈຳນວນສະຕັອກອັດຕະໂນມັດ"
  ],
  "กำลังรวบรวมยอดขาย...": [
    "Loading sales...",
    "ກຳລັງໂຫຼດຍອດຂາຍ..."
  ],
  "ไม่พบยอดขายสินค้า Optical ใน 30 วันที่ผ่านมา": [
    "No Optical sales in the past 30 days",
    "ບໍ່ພົບຍອດຂາຍ Optical ໃນ 30 ວັນ"
  ],
  "ยอดขายมีมากกว่า 2,000 บิล แสดงอันดับจาก 2,000 บิลล่าสุดเท่านั้น": [
    "More than 2,000 receipts; ranked using the latest 2,000",
    "ມີຫຼາຍກວ່າ 2,000 ບິນ · ສະແດງອັນດັບຈາກ 2,000 ບິນຫຼ້າສຸດ"
  ],
  "อันดับ": [
    "Rank",
    "ອັນດັບ"
  ],
  "จำนวนขาย (ชิ้น)": [
    "Units sold",
    "ຈຳນວນຂາຍ (ຊິ້ນ)"
  ],
  "ยอดขาย": [
    "Revenue",
    "ຍອດຂາຍ"
  ],
  "คัดลอกรหัส": [
    "Copy SKU",
    "ຄັດລອກ SKU"
  ],
  "+ เพิ่มแถว": [
    "+ Add row",
    "+ ເພີ່ມແຖວ"
  ],
  "ยกเลิก": [
    "Cancel",
    "ຍົກເລີກ"
  ],
  "กำลังบันทึก...": [
    "Saving...",
    "ກຳລັງບັນທຶກ..."
  ],
  "ยืนยันลบ": [
    "Delete product",
    "ຢືນຢັນລຶບ"
  ],
  "บันทึกทั้งหมด": [
    "Save all",
    "ບັນທຶກທັງໝົດ"
  ],
  "บันทึก": [
    "Save",
    "ບັນທຶກ"
  ],
  "ชื่อสินค้า *": [
    "Product name *",
    "ຊື່ສິນຄ້າ *"
  ],
  "SKU / บาร์โค้ด *": [
    "SKU / Barcode *",
    "SKU / ບາໂຄດ *"
  ],
  "แบรนด์ / ยี่ห้อ": [
    "Brand",
    "ຍີ່ຫໍ້"
  ],
  "รุ่น / ชื่อเลนส์": [
    "Model / Lens name",
    "ຮຸ່ນ / ຊື່ເລນ"
  ],
  "สี / Index": [
    "Color / Index",
    "ສີ / Index"
  ],
  "ขนาด / SPH": [
    "Size / SPH",
    "ຂະໜາດ / SPH"
  ],
  "ลบแถว": [
    "Remove row",
    "ລຶບແຖວ"
  ],
  "กรอกเอง": [
    "Enter manually",
    "ປ້ອນເອງ"
  ],
  "สาขา: ": [
    "Branch: ",
    "ສາຂາ: "
  ],
  "สาขา": [
    "Branch",
    "ສາຂາ"
  ],
  "ข้อมูลแยกตาม Tenant และ Branch": [
    "Data isolated by Tenant and Branch",
    "ຂໍ້ມູນແຍກຕາມ Tenant ແລະ Branch"
  ],
  "สินค้าขายดี": [
    "Best sellers",
    "ສິນຄ້າຂາຍດີ"
  ],
  "หมายเหตุ": [
    "Notes",
    "ໝາຍເຫດ"
  ],
  "เลือกสาขาที่ต้องการลงสินค้า": [
    "Choose destination branch",
    "ເລືອກສາຂາສຳລັບສິນຄ້າ"
  ],
  "โหลดสินค้าขายดีไม่สำเร็จ": [
    "Unable to load best sellers",
    "ໂຫຼດສິນຄ້າຂາຍດີບໍ່ສຳເລັດ"
  ],
  "โหลดไม่สำเร็จ": [
    "Unable to load",
    "ໂຫຼດບໍ່ສຳເລັດ"
  ],
  "เกิดข้อผิดพลาด": [
    "Unexpected error",
    "ມີຂໍ້ຜິດພາດ"
  ],
  "บันทึกไม่สำเร็จ": [
    "Unable to save",
    "ບັນທຶກບໍ່ສຳເລັດ"
  ],
  "แสดง": [
    "Showing",
    "ສະແດງ"
  ],
  "จาก": [
    "of",
    "ຈາກ"
  ],
  "รายการ": [
    "items",
    "ລາຍການ"
  ],
  "ประเภท *": [
    "Type *",
    "ປະເພດ *"
  ],
  "SKU / บาร์โค้ด (กรอกเอง) *": [
    "SKU / Barcode (manual) *",
    "SKU / ບາໂຄດ (ປ້ອນເອງ) *"
  ],
  "จัดอันดับตามจำนวนที่ขายจริง (เฉพาะบิลสำเร็จ ไม่รวมยกเลิก)": [
    "Ranked by completed sales (excluding cancellations)",
    "ຈັດອັນດັບຕາມຍອດຂາຍສຳເລັດ (ບໍ່ລວມຍົກເລີກ)"
  ],
  "ต้องการลบสินค้า": [
    "Delete product",
    "ຕ້ອງການລຶບສິນຄ້າ"
  ],
  "ใช่หรือไม่? ระบบใช้ Soft Delete และจะบล็อกสินค้าที่มีสต๊อก สูตร หรือใบสั่งงานผูกอยู่": [
    "? Soft delete is used. Products with stock, recipes or orders cannot be deleted.",
    "ຫຼືບໍ່? ລະບົບໃຊ້ Soft Delete ແລະ ປ້ອງກັນການລຶບສິນຄ້າທີ່ມີສະຕັອກ ຫຼື ໃບສັ່ງງານ"
  ],
  "กรุณากรอกชื่อและ SKU / บาร์โค้ด ในแถว ": [
    "Enter name and SKU/barcode in row ",
    "ປ້ອນຊື່ ແລະ SKU/ບາໂຄດ ໃນແຖວ "
  ],
  "รูปแบบ SKU / บาร์โค้ดไม่ถูกต้อง ในแถว ": [
    "Invalid SKU/barcode in row ",
    "SKU/ບາໂຄດບໍ່ຖືກຕ້ອງ ແຖວ "
  ],
  "SKU / บาร์โค้ดซ้ำ ในแถว ": [
    "Duplicate SKU/barcode in row ",
    "SKU/ບາໂຄດຊ້ຳ ແຖວ "
  ],
  "ราคาสินค้าไม่ถูกต้อง ในแถว ": [
    "Invalid price in row ",
    "ລາຄາບໍ່ຖືກຕ້ອງ ແຖວ "
  ],
  "แสดงรายการ": [
    "Items shown",
    "ສະແດງລາຍການ"
  ]
};
export function opticalStockText(lang:Language,thai:string):string{
  if(lang==="th")return thai;
  const translated=copy[thai];
  return translated?.[lang==="lo"?1:0]??thai;
}

/** Localize validation errors while retaining row index and SKU identity. */
export function opticalStockError(lang:Language,error:string):string{
  if(lang==="th")return error;
  for(const prefix of [
    "กรุณากรอกชื่อและ SKU / บาร์โค้ด ในแถว ",
    "รูปแบบ SKU / บาร์โค้ดไม่ถูกต้อง ในแถว ",
    "SKU / บาร์โค้ดซ้ำ ในแถว ",
    "ราคาสินค้าไม่ถูกต้อง ในแถว "
  ]){
    if(error.startsWith(prefix))return opticalStockText(lang,prefix)+error.slice(prefix.length);
  }
  return opticalStockText(lang,error);
}

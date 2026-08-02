const downloadUrl = "/download/windows-runtime/latest";

export const metadata = {
  title: "ดาวน์โหลด CpIPOS Windows Runtime",
  description: "ดาวน์โหลดโปรแกรม CpIPOS Windows Runtime สำหรับเครื่อง POS Windows."
};

export default function WindowsRuntimeDownloadPage() {
  return (
    <main className="h-dvh overflow-y-auto bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 sm:py-8">
      <section className="mx-auto max-w-4xl rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="mb-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-300 sm:text-sm">CpIPOS Download</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">ดาวน์โหลด CpIPOS Windows Runtime</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            โปรแกรม Windows สำหรับเครื่อง POS ที่เปิด CpIPOS แบบไม่มี address bar พร้อม Local Print Bridge ในตัวที่พอร์ต 127.0.0.1:3210
          </p>
        </div>

        <div className="rounded-2xl border border-sky-800 bg-sky-950/50 p-5 text-sm leading-7 text-sky-100">
          <p className="font-semibold text-sky-200">เหมาะสำหรับ</p>
          <p>Windows cashier, mini PC, notebook หรือเครื่อง POS ที่ต้องการใช้งาน CpIPOS เป็นโปรแกรม Windows จริง</p>
          <p>เวอร์ชันนี้ใช้เว็บ CpIPOS เดิมเป็น UI หลัก และมีตัวช่วยพิมพ์ในเครื่องสำหรับ Windows</p>
        </div>

        <div className="mt-7">
          <a
            href={downloadUrl}
            className="inline-flex w-full items-center justify-center rounded-2xl bg-sky-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-sky-950/50 transition hover:bg-sky-400 sm:w-auto"
          >
            ดาวน์โหลดสำหรับ Windows
          </a>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            หากไฟล์ติดตั้งยังอยู่ระหว่างเตรียม ระบบจะแสดงข้อความแจ้งสถานะในหน้าเว็บ ไม่พาไปหน้า Not Found
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="mb-3 text-xl font-bold text-white">วิธีใช้งาน</h2>
          <ol className="space-y-2 text-sm leading-7 text-slate-300">
            <li>1. กดดาวน์โหลดสำหรับ Windows</li>
            <li>2. แตกไฟล์ ZIP ลงเครื่อง POS หรือแฟลชไดรฟ์</li>
            <li>3. เปิดไฟล์ Cpipos.WindowsRuntime.exe</li>
            <li>4. ถ้าเครื่องพิมพ์ชื่อ MTP-II ให้เปิดด้วยคำสั่ง Cpipos.WindowsRuntime.exe --printer MTP-II</li>
            <li>5. ตรวจสอบ Bridge ได้ที่ http://127.0.0.1:3210/health และ http://127.0.0.1:3210/printers</li>
          </ol>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/50 p-5 text-sm leading-7 text-amber-100">
          <p className="font-semibold text-amber-200">หมายเหตุ</p>
          <p>เวอร์ชันนี้ยังไม่ใช่ระบบขาย offline เต็มรูปแบบ ระบบ local database, offline orders และ sync queue จะเป็นเฟสถัดไป</p>
        </div>
      </section>
    </main>
  );
}

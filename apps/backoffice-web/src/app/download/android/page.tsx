const downloadUrl = "/download/android/latest";

export const metadata = {
  title: "ดาวน์โหลด CpIPOS Android",
  description: "ดาวน์โหลด CpIPOS Android APK สำหรับแท็บเล็ต POS"
};

export default function AndroidRuntimeDownloadPage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 sm:py-8">
      <section className="mx-auto max-w-4xl rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="mb-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-300 sm:text-sm">CpIPOS Android</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">ดาวน์โหลด CpIPOS Android (APK)</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            แอป Android สำหรับแท็บเล็ต POS เปิดระบบ CpIPOS แบบเต็มจอแนวนอน ไม่มี address bar เว็บ UI เดิมยังเป็นแหล่งข้อมูลหลักของหน้าจอขาย
            แอปนี้เป็นเปลือกแสดงผลเท่านั้น
          </p>
        </div>

        <div className="rounded-2xl border border-sky-800 bg-sky-950/50 p-5 text-sm leading-7 text-sky-100">
          <p className="font-semibold text-sky-200">แยกจาก CpIPOS Web</p>
          <p>CpIPOS Web ยังคงเป็นเว็บหลักสำหรับเข้าใช้งานผ่านเบราว์เซอร์ ส่วนหน้านี้ใช้สำหรับดาวน์โหลดแอป Android โดยเฉพาะ</p>
        </div>

        <div className="mt-7">
          <a
            href={downloadUrl}
            className="inline-flex w-full items-center justify-center rounded-2xl bg-sky-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-sky-950/50 transition hover:bg-sky-400 sm:w-auto"
          >
            ดาวน์โหลด CpIPOS Android (APK)
          </a>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            ไฟล์ CpIPOS-Android-debug.apk ต้องเปิด &quot;อนุญาตติดตั้งจากแหล่งที่ไม่รู้จัก&quot; (Install unknown apps) ก่อนติดตั้ง
            เพราะยังไม่ได้เผยแพร่ผ่าน Google Play
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="mb-3 text-xl font-bold text-white">วิธีติดตั้งบนแท็บเล็ต Android</h2>
          <ol className="space-y-2 text-sm leading-7 text-slate-300">
            <li>1. เปิดหน้านี้จากเบราว์เซอร์บนแท็บเล็ต Android แล้วกดปุ่มดาวน์โหลด</li>
            <li>2. เมื่อเบราว์เซอร์เตือนเรื่องไฟล์ไม่รู้จัก ให้กด &quot;ดาวน์โหลดต่อ&quot;</li>
            <li>3. เปิดไฟล์ CpIPOS-Android-debug.apk แล้วอนุญาตติดตั้งจากแหล่งที่ไม่รู้จักตามที่ระบบขอ</li>
            <li>4. กดติดตั้ง แล้วเปิดแอป CpIPOS</li>
            <li>5. เข้าสู่ระบบด้วยรหัสร้านเหมือนบนเว็บปกติ</li>
          </ol>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/50 p-5 text-sm leading-7 text-amber-100">
          <p className="font-semibold text-amber-200">สถานะฟีเจอร์</p>
          <p>
            เวอร์ชันนี้เป็น Android Runtime เฟส 1: เปิดเว็บ POS แบบเต็มจอแนวนอนเท่านั้น ยังไม่มีเครื่องพิมพ์/ลิ้นชักผ่าน native bridge
            ให้ใช้ Bluetooth Print Agent บนเว็บแทนในระหว่างนี้ และยังเป็นไฟล์ debug (ยังไม่ได้เซ็นชื่อแบบ release)
          </p>
        </div>
      </section>
    </main>
  );
}

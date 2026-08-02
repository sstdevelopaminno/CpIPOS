const posUrl = "/login/store";

export const metadata = {
  title: "ใช้ CpIPOS บน Windows",
  description: "เปิดใช้งาน CpIPOS ผ่านเว็บ/PWA บน Windows โดยใช้เว็บเป็นตัวหลักและอัปเดตทันทีเมื่อระบบออนไลน์"
};

export default function WindowsRuntimeDownloadPage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 sm:py-8">
      <section className="mx-auto max-w-4xl rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="mb-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-300 sm:text-sm">CpIPOS Web App</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">ใช้งาน CpIPOS บน Windows ผ่านเว็บ</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            CpIPOS ใช้เว็บแอปเป็นตัวหลัก ลูกค้าสามารถเปิดใช้งานผ่าน Microsoft Edge หรือ Google Chrome ได้ทันที โดยไม่ต้องรอไฟล์ติดตั้ง Windows EXE
          </p>
        </div>

        <div className="rounded-2xl border border-sky-800 bg-sky-950/50 p-5 text-sm leading-7 text-sky-100">
          <p className="font-semibold text-sky-200">แนวทางที่ใช้ตอนนี้</p>
          <p>Windows cashier, mini PC, notebook และเครื่อง POS ให้เปิด CpIPOS ผ่านเว็บ/PWA เป็นหลัก เพื่อให้ลูกค้าเข้าถึงง่ายและได้รับ UI ล่าสุดทันทีหลัง deploy</p>
          <p>งานพิมพ์และอุปกรณ์ POS ให้ใช้ Local Bridge/Print Adapter เฉพาะเครื่องแคชเชียร์ที่ต้องต่อเครื่องพิมพ์จริง ไม่บังคับลูกค้าทุกเครื่องติดตั้งโปรแกรม EXE</p>
        </div>

        <div className="mt-7">
          <a
            href={posUrl}
            className="inline-flex w-full items-center justify-center rounded-2xl bg-sky-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-sky-950/50 transition hover:bg-sky-400 sm:w-auto"
          >
            เปิด CpIPOS Web
          </a>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            แนะนำให้เปิดด้วย Microsoft Edge หรือ Google Chrome แล้วเลือกติดตั้งเป็นแอป เพื่อให้ใช้งานเหมือนโปรแกรมบน Windows โดยยังอัปเดตผ่านเว็บทันที
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="mb-3 text-xl font-bold text-white">วิธีใช้งานบนเครื่อง Windows</h2>
          <ol className="space-y-2 text-sm leading-7 text-slate-300">
            <li>1. กดปุ่ม “เปิด CpIPOS Web”</li>
            <li>2. เข้าสู่ระบบตาม flow เดิม: รหัสร้าน → เลือกสาขา → ยืนยันพนักงาน → เลือกอุปกรณ์ → หน้า POS</li>
            <li>3. ใน Microsoft Edge หรือ Chrome ให้กดเมนูมุมขวาบน แล้วเลือกติดตั้งเว็บไซต์นี้เป็นแอป / Install app</li>
            <li>4. ปักหมุดแอปไว้ที่ Taskbar หรือ Desktop ของเครื่อง POS</li>
            <li>5. เมื่อระบบมีการอัปเดต ลูกค้าจะเห็น UI ล่าสุดผ่านเว็บโดยไม่ต้องติดตั้ง EXE ใหม่</li>
          </ol>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/50 p-5 text-sm leading-7 text-amber-100">
          <p className="font-semibold text-amber-200">หมายเหตุเรื่องเครื่องพิมพ์</p>
          <p>ถ้าเป็นเครื่องแคชเชียร์ที่ต้องพิมพ์ใบเสร็จ ให้ใช้โหมด Local Bridge/Print Adapter ตามการตั้งค่าระบบพิมพ์ ส่วน Web Serial จะไม่ใช่เส้นหลักอีกต่อไป</p>
        </div>
      </section>
    </main>
  );
}

const downloadUrl = "/download/windows-runtime/latest";

export const metadata = {
  title: "ดาวน์โหลด CpIPOS Windows",
  description: "ดาวน์โหลดตัวติดตั้ง CpIPOS Windows Runtime สำหรับเครื่อง POS Windows."
};

export default function WindowsRuntimeDownloadPage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 sm:py-8">
      <section className="mx-auto max-w-4xl rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="mb-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-300 sm:text-sm">CpIPOS Windows</p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">ดาวน์โหลดตัวติดตั้ง CpIPOS สำหรับ Windows</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            ตัวติดตั้ง CpIPOS Windows Runtime สำหรับเครื่อง POS Windows เปิดระบบ CpIPOS ด้วย WebView2 แบบไม่มี address bar และมี Local Print Bridge ในตัวสำหรับเครื่องแคชเชียร์
          </p>
        </div>

        <div className="rounded-2xl border border-sky-800 bg-sky-950/50 p-5 text-sm leading-7 text-sky-100">
          <p className="font-semibold text-sky-200">แยกจาก CpIPOS Web</p>
          <p>CpIPOS Web ยังคงเป็นเว็บหลักสำหรับเข้าใช้งานผ่าน browser ส่วนหน้านี้ใช้สำหรับดาวน์โหลดตัวติดตั้ง CpIPOS Windows โดยเฉพาะ</p>
          <p>เมื่อติดตั้งแล้ว ระบบจะสร้าง shortcut สำหรับเปิดโปรแกรม CpIPOS Windows บนเครื่อง POS</p>
        </div>

        <div className="mt-7">
          <a
            href={downloadUrl}
            className="inline-flex w-full items-center justify-center rounded-2xl bg-sky-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-sky-950/50 transition hover:bg-sky-400 sm:w-auto"
          >
            ดาวน์โหลดตัวติดตั้ง Windows
          </a>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            ไฟล์หลักคือ CpIPOS-WindowsRuntime-Setup.exe สำหรับติดตั้งลงเครื่อง Windows และสร้าง shortcut ให้อัตโนมัติ
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="mb-3 text-xl font-bold text-white">วิธีติดตั้งบนเครื่อง POS Windows</h2>
          <ol className="space-y-2 text-sm leading-7 text-slate-300">
            <li>1. กดปุ่ม “ดาวน์โหลดตัวติดตั้ง Windows”</li>
            <li>2. เปิดไฟล์ CpIPOS-WindowsRuntime-Setup.exe</li>
            <li>3. กดติดตั้งตามขั้นตอน ระบบจะสร้าง shortcut ที่ Desktop/Start Menu</li>
            <li>4. เปิดโปรแกรม CpIPOS Windows Runtime จาก shortcut</li>
            <li>5. ปิดโปรแกรมได้จากปุ่ม “ปิดโปรแกรม” ด้านบนขวา หรือกด Esc / Alt+F4</li>
          </ol>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/50 p-5 text-sm leading-7 text-amber-100">
          <p className="font-semibold text-amber-200">สถานะฟีเจอร์</p>
          <p>เวอร์ชันนี้เป็น Windows Runtime + Local Print Bridge สำหรับทดสอบเครื่อง POS Windows จริง ระบบขาย offline เต็มรูปแบบและ sync queue ยังเป็นเฟสถัดไป</p>
        </div>
      </section>
    </main>
  );
}

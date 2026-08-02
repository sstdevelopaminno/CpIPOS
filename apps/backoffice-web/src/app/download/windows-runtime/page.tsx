const downloadUrl = "https://github.com/sstdevelopaminno/CpIPOS/releases/download/windows-runtime-latest/CpIPOS-WindowsRuntime-win-x64.zip";
const releaseUrl = "https://github.com/sstdevelopaminno/CpIPOS/releases/tag/windows-runtime-latest";
const actionsUrl = "https://github.com/sstdevelopaminno/CpIPOS/actions/workflows/build-windows-runtime.yml";

export const metadata = {
  title: "CpIPOS Windows Runtime Download",
  description: "Download CpIPOS Windows Runtime for Windows POS terminals."
};

export default function WindowsRuntimeDownloadPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <section className="mx-auto max-w-4xl rounded-3xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-sky-300">CpIPOS Download</p>
          <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">ดาวน์โหลด CpIPOS Windows Runtime</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            โปรแกรม Windows สำหรับเครื่อง POS ที่เปิด CpIPOS ผ่าน WebView2 แบบไม่มี address bar และมี Local Print Bridge ในตัวที่พอร์ต 127.0.0.1:3210
          </p>
        </div>

        <div className="grid gap-4 rounded-2xl border border-sky-800 bg-sky-950/50 p-5 text-sm leading-7 text-sky-100">
          <p className="font-semibold text-sky-200">เหมาะสำหรับ</p>
          <p>Windows cashier, mini PC, notebook หรือเครื่อง POS ที่ต้องการทดสอบ CpIPOS เป็นโปรแกรม Windows จริง</p>
          <p>ยังไม่ใช่ offline sales engine เต็มรูปแบบ ระบบขาย offline พร้อม sync queue จะเป็นเฟสถัดไป</p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={downloadUrl}
            className="inline-flex items-center justify-center rounded-2xl bg-sky-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-sky-950/50 transition hover:bg-sky-400"
          >
            ดาวน์โหลด Windows Runtime ZIP
          </a>
          <a
            href={releaseUrl}
            className="inline-flex items-center justify-center rounded-2xl border border-slate-600 px-6 py-4 text-base font-semibold text-slate-100 transition hover:bg-slate-800"
          >
            เปิดหน้า Release
          </a>
          <a
            href={actionsUrl}
            className="inline-flex items-center justify-center rounded-2xl border border-slate-600 px-6 py-4 text-base font-semibold text-slate-100 transition hover:bg-slate-800"
          >
            ดูสถานะ Build
          </a>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="mb-3 text-xl font-bold text-white">วิธีใช้งาน</h2>
          <ol className="space-y-2 text-sm leading-7 text-slate-300">
            <li>1. กดดาวน์โหลด ZIP</li>
            <li>2. แตกไฟล์ลงเครื่อง POS หรือแฟลชไดรฟ์</li>
            <li>3. เปิดไฟล์ Cpipos.WindowsRuntime.exe</li>
            <li>4. สำหรับเครื่องพิมพ์ชื่อ MTP-II ให้เปิดด้วยคำสั่ง Cpipos.WindowsRuntime.exe --printer MTP-II</li>
            <li>5. เช็ก Bridge ได้ที่ http://127.0.0.1:3210/health และ http://127.0.0.1:3210/printers</li>
          </ol>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/50 p-5 text-sm leading-7 text-amber-100">
          <p className="font-semibold text-amber-200">หมายเหตุสำคัญ</p>
          <p>ลิงก์ดาวน์โหลดจะใช้งานได้หลัง GitHub Actions build สำเร็จและสร้าง Release asset แล้ว ถ้ากดแล้วไม่พบไฟล์ ให้เปิดปุ่มดูสถานะ Build ก่อน</p>
        </div>
      </section>
    </main>
  );
}

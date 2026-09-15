"use client";

const WINDOWS_DESKTOP_VERSION = "0.2.7";
const WINDOWS_DESKTOP_DOWNLOAD_URL = "/download/windows-runtime/latest";
const WINDOWS_DESKTOP_FILE = "CpIPOS.Desktop_0.2.7_x64-setup.exe";

export function DownloadCenterWindows027() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-[radial-gradient(circle_at_top,_#0b2447_0%,_#061227_38%,_#020617_78%)] text-slate-100">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-sky-400/25 bg-sky-400/10 text-lg font-black text-sky-300">CP</div>
            <div>
              <p className="text-lg font-black tracking-tight text-white">CpIPOS</p>
              <p className="text-xs font-semibold text-slate-400">Download Center</p>
            </div>
          </div>
          <a href="/login/store" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 px-4 text-sm font-bold text-slate-100 transition hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-200">เข้าใช้งาน Web App</a>
        </header>

        <section className="mx-auto mt-14 max-w-4xl text-center sm:mt-20">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Windows Desktop Ready
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">ดาวน์โหลด CpIPOS Desktop</h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
            เวอร์ชันล่าสุดสำหรับ Windows Desktop POS พร้อมใช้งานแบบ Free Forever ชั่วคราว ก่อนเชื่อมต่อระบบหลังบ้าน IT, License และ MDM ในรอบถัดไป
          </p>
        </section>

        <section className="mx-auto mt-10 grid w-full max-w-5xl gap-6 lg:grid-cols-[1.12fr_.88fr]">
          <article className="relative overflow-hidden rounded-[2rem] border border-sky-300/45 bg-gradient-to-b from-sky-900/70 via-blue-950/65 to-slate-950 p-7 shadow-2xl shadow-sky-950/40">
            <div className="absolute right-0 top-0 rounded-bl-3xl bg-sky-300 px-5 py-2 text-xs font-black uppercase tracking-wide text-slate-950">Windows Desktop v{WINDOWS_DESKTOP_VERSION}</div>
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-sky-300/15 text-sky-200">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden="true">
                <path d="M3 5.2 10.5 4v7H3V5.2ZM11.5 3.8 21 2.4V11h-9.5V3.8ZM3 12h7.5v7L3 17.8V12Zm8.5 0H21v9.6l-9.5-1.4V12Z" fill="currentColor" />
              </svg>
            </div>
            <p className="mt-7 text-xs font-extrabold uppercase tracking-[0.14em] text-sky-200">Windows 10/11 Desktop POS · v{WINDOWS_DESKTOP_VERSION}</p>
            <h2 className="mt-3 text-3xl font-black leading-tight text-white">CpIPOS Desktop - Windows</h2>
            <p className="mt-5 text-sm leading-7 text-slate-300">
              ตัวติดตั้ง Windows Desktop POS สำหรับเครื่องขายหน้าร้าน แก้ตะกร้าค้างหลังปิดบิล, แสดง Splash logo ก่อนเข้าโปรแกรม, ระบบขายด้วยคีย์บอร์ด, ใบเสร็จ 80mm, ลิ้นชักเงินสด, Export ข้อมูล และใบสรุปปิดกะ
            </p>
            <div className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-bold leading-6 text-emerald-100">
              รุ่นนี้เปิดใช้งานฟรีตลอดชั่วคราว ไม่บังคับ License Server และยังไม่เชื่อม MDM/Backend IT อัตโนมัติ
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />Ready</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-300/25 bg-sky-300/10 px-3 py-1.5 text-xs font-bold text-sky-200">Free Forever</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-600/60 bg-slate-900/70 px-3 py-1.5 text-xs font-bold text-slate-300">80mm receipt</span>
            </div>
            <div className="mt-8">
              <p className="mb-4 truncate text-xs text-slate-500">ไฟล์: {WINDOWS_DESKTOP_FILE}</p>
              <a href={WINDOWS_DESKTOP_DOWNLOAD_URL} className="inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-sky-300 px-5 py-4 text-center text-sm font-black text-slate-950 shadow-lg shadow-sky-950/40 transition hover:bg-sky-200">
                ดาวน์โหลด CpIPOS Desktop {WINDOWS_DESKTOP_VERSION}
              </a>
            </div>
          </article>

          <aside className="rounded-[2rem] border border-slate-700/70 bg-slate-950/70 p-7 shadow-2xl shadow-black/20">
            <h3 className="text-xl font-black text-white">รายละเอียดเวอร์ชัน</h3>
            <div className="mt-5 space-y-4 text-sm leading-7 text-slate-300">
              <p><strong className="text-sky-200">Version:</strong> {WINDOWS_DESKTOP_VERSION}</p>
              <p><strong className="text-sky-200">Platform:</strong> Windows 10/11 x64</p>
              <p><strong className="text-sky-200">Status:</strong> Stable test release</p>
              <p><strong className="text-sky-200">License:</strong> Free Forever release</p>
            </div>
            <div className="mt-7 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-bold leading-6 text-amber-100">
              ก่อนติดตั้งใหม่ ให้ปิด CpIPOS Desktop ตัวเก่าก่อน หากติดตั้งทับแล้วไม่เปลี่ยน ให้ถอนเวอร์ชันเก่าออกก่อนแล้วติดตั้งใหม่
            </div>
            <a href="/download/android/latest" className="mt-6 inline-flex w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-bold text-slate-200 transition hover:border-emerald-400/45 hover:text-emerald-200">ดาวน์โหลด Android POS</a>
          </aside>
        </section>

        <footer className="mt-auto pt-10 text-center text-xs text-slate-500">CUTTING POINT TECH CO., LTD. · CpIPOS Download Center</footer>
      </div>
    </main>
  );
}

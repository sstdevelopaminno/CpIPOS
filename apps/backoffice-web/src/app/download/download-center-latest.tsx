"use client";

const ANDROID_POS_LATEST_URL = "/download/android/latest";

const apps = [
  {
    title: "CpIPOS POS - Android Tablet",
    platform: "Android Tablet POS · Latest Stable",
    description: "CpIPOS Android POS Stable สำหรับเครื่องขายหน้าร้าน พร้อม Native Print Agent, MDM และระบบพิมพ์ LAN / USB / Bluetooth โดยปุ่มนี้ติดตาม Stable Signed APK ล่าสุดอัตโนมัติ",
    file: "CpIPOS-Android-POS.apk",
    status: "Stable Signed · พร้อมดาวน์โหลด",
    ready: true,
    href: ANDROID_POS_LATEST_URL
  },
  {
    title: "CpIPOS Mobile - Android",
    platform: "Android Phone / Tablet",
    description: "แอปสำหรับเจ้าของร้าน ผู้จัดการ และพนักงานบนมือถือ Android แยกจาก Android POS หน้าร้าน",
    file: "CpIPOS-Mobile.apk",
    status: "กำลังพัฒนา",
    ready: false
  },
  {
    title: "CpIPOS POS - Windows",
    platform: "Windows POS Terminal",
    description: "Windows POS Runtime สำหรับเครื่องขายหน้าร้าน พร้อม local runtime bridge และ printer/cash-drawer integration",
    file: "CpIPOS-WindowsRuntime-Setup.exe",
    status: "กำลังพัฒนา",
    ready: false
  },
  {
    title: "CpIPOS IT Admin Runtime",
    platform: "Windows IT Admin",
    description: "Windows Runtime สำหรับงาน IT Admin, device management, diagnostics และ MDM operation",
    file: "CpIPOS-ITAdminRuntime-Setup.exe",
    status: "กำลังพัฒนา",
    ready: false
  }
] as const;

function AppIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
        <rect x="4" y="2.5" width="16" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 18.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
        <rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 18.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
      <path d="M3 5.2 10.5 4v7H3V5.2ZM11.5 3.8 21 2.4V11h-9.5V3.8ZM3 12h7.5v7L3 17.8V12Zm8.5 0H21v9.6l-9.5-1.4V12Z" fill="currentColor" />
    </svg>
  );
}

export function DownloadCenterLatest() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-[radial-gradient(circle_at_top,_#0b2447_0%,_#061227_34%,_#020617_72%)] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sm font-black text-sky-300">CP</div>
            <div>
              <p className="font-black tracking-tight text-white">CpIPOS</p>
              <p className="text-xs text-slate-400">Download Center</p>
            </div>
          </div>
          <a href="/login/store" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 px-4 text-sm font-bold text-slate-100 transition hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-200">เข้าใช้งาน Web App</a>
        </header>

        <section className="mx-auto mt-16 max-w-4xl text-center sm:mt-20">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] text-sky-300">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            CpIPOS Applications
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl">ดาวน์โหลด Android POS</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">ดาวน์โหลด Stable Signed APK ล่าสุดจาก URL เดิมได้ตลอด เมื่อ Android POS รุ่นใหม่ผ่าน Production Release ระบบจะสลับไฟล์ให้โดยอัตโนมัติ</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3 text-xs font-semibold">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">Android POS Latest Stable</span>
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-slate-300">Stable signed APK</span>
          </div>
        </section>

        <section className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4 lg:mt-16">
          {apps.map((app, index) => (
            <article key={app.title} className={`relative flex min-h-[390px] flex-col overflow-hidden rounded-3xl border p-6 shadow-2xl sm:p-7 ${app.ready ? "border-sky-400/35 bg-gradient-to-b from-sky-950/70 to-slate-900/90 shadow-sky-950/30" : "border-slate-800 bg-slate-900/75 shadow-black/20"}`}>
              {app.ready ? <div className="absolute right-0 top-0 rounded-bl-2xl bg-sky-400 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-slate-950">Latest</div> : null}
              <div className={`grid h-14 w-14 place-items-center rounded-2xl ${app.ready ? "bg-sky-400/15 text-sky-300" : "bg-slate-800 text-slate-300"}`}><AppIcon index={index} /></div>
              <div className="mt-6">
                <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-sky-300">{app.platform}</p>
                <h2 className="mt-3 text-2xl font-black leading-tight text-white">{app.title}</h2>
                <p className="mt-4 text-sm leading-7 text-slate-300">{app.description}</p>
              </div>
              <div className="mt-5">
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${app.ready ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-400/20 bg-amber-400/10 text-amber-200"}`}>
                  <span className={`h-2 w-2 rounded-full ${app.ready ? "bg-emerald-400" : "bg-amber-400"}`} />
                  {app.status}
                </span>
              </div>
              <div className="mt-auto pt-7">
                <p className="mb-4 truncate text-xs text-slate-500">ไฟล์: {app.file}</p>
                {app.ready && "href" in app ? (
                  <a href={app.href} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-sky-950/40 transition hover:bg-sky-300">ดาวน์โหลด Android POS ล่าสุด</a>
                ) : (
                  <div className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 px-5 py-3 text-sm font-black text-slate-400">กำลังพัฒนา</div>
                )}
              </div>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 px-5 py-4 text-center text-sm text-slate-400">Stable Signed APK สามารถติดตั้งทับเวอร์ชันเดิมที่ใช้ signing certificate เดียวกันได้ โดยไม่ต้องถอนแอปก่อน</section>
      </div>
    </main>
  );
}

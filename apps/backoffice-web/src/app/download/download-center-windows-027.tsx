"use client";

const WINDOWS_VERSION = "0.3.3";
const ANDROID_VERSION = "1.0.23";
const WINDOWS_DOWNLOAD_URL = "/download/windows-runtime/latest";
const ANDROID_DOWNLOAD_URL = "/download/android/latest";
const WINDOWS_FILE = "CpIPOS.Desktop_0.3.3_x64-setup.exe";
const ANDROID_FILE = "CpIPOS-Android-POS-1.0.23.apk";

type DownloadCardProps = {
  title: string;
  platform: string;
  version: string;
  fileName: string;
  href: string;
  tone: "windows" | "android";
};

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
      <path d="M3 5.3 10.4 4v7H3V5.3Zm8.6-1.5L21 2.4V11h-9.4V3.8ZM3 12.2h7.4v7L3 17.9v-5.7Zm8.6 0H21v9.4l-9.4-1.5v-7.9Z" fill="currentColor" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden="true">
      <path d="M7.2 9.2h9.6a1.8 1.8 0 0 1 1.8 1.8v6.2a2.4 2.4 0 0 1-2.4 2.4H7.8a2.4 2.4 0 0 1-2.4-2.4V11a1.8 1.8 0 0 1 1.8-1.8Z" fill="currentColor" />
      <path d="M8.1 7.2 6.6 4.7m9.3 2.5 1.5-2.5M8.5 12.6h.1m6.8 0h.1" stroke="#052e2b" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3.6 11.3v5.2m16.8-5.2v5.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" aria-hidden="true">
      <path d="M7 3.8h6.6L18 8.2v12H7v-16Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.5 4v4.5H18" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadCard({ title, platform, version, fileName, href, tone }: DownloadCardProps) {
  const isWindows = tone === "windows";
  const accent = isWindows ? "sky" : "emerald";

  return (
    <article className={`group relative overflow-hidden rounded-[2rem] border ${isWindows ? "border-sky-300/35" : "border-emerald-300/35"} bg-slate-950/45 p-6 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-8`}>
      <div className={`absolute inset-0 opacity-70 transition group-hover:opacity-100 ${isWindows ? "bg-[radial-gradient(circle_at_20%_15%,rgba(56,189,248,.24),transparent_34%),radial-gradient(circle_at_80%_70%,rgba(59,130,246,.18),transparent_36%)]" : "bg-[radial-gradient(circle_at_20%_15%,rgba(52,211,153,.24),transparent_34%),radial-gradient(circle_at_82%_70%,rgba(20,184,166,.18),transparent_38%)]"}`} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className={`grid h-16 w-16 place-items-center rounded-3xl border ${isWindows ? "border-sky-300/25 bg-sky-400/15 text-sky-200" : "border-emerald-300/25 bg-emerald-400/15 text-emerald-200"}`}>
            {isWindows ? <WindowsIcon /> : <AndroidIcon />}
          </div>
          <div className={`rounded-full border px-4 py-2 text-sm font-black ${isWindows ? "border-sky-300/35 bg-sky-400/15 text-sky-100" : "border-emerald-300/35 bg-emerald-400/15 text-emerald-100"}`}>v{version}</div>
        </div>

        <div className="mt-7">
          <h2 className="text-3xl font-black tracking-tight text-white">{title}</h2>
          <p className="mt-2 text-base font-semibold text-slate-300">{platform}</p>
        </div>

        <div className="mt-6 flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          <FileIcon />
          <span className="truncate">{fileName}</span>
        </div>

        <a href={href} className={`mt-7 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl px-5 text-base font-black text-slate-950 shadow-lg transition hover:-translate-y-0.5 ${accent === "sky" ? "bg-sky-300 shadow-sky-950/40 hover:bg-sky-200" : "bg-emerald-300 shadow-emerald-950/40 hover:bg-emerald-200"}`}>
          <DownloadIcon />
          ดาวน์โหลด {isWindows ? "Windows" : "Android"}
        </a>
      </div>
    </article>
  );
}

export function DownloadCenterWindows027() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#020617] text-slate-100">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-44 h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10rem] left-1/2 h-[26rem] w-[44rem] -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-dvh max-w-7xl flex-col px-5 py-7 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src="/brand/cpipos-symbol-transparent.png"
              alt="CpIPOS"
              className="h-14 w-14 object-contain drop-shadow-[0_0_24px_rgba(56,189,248,.35)]"
            />
            <div className="leading-tight">
              <p className="text-xl font-black tracking-tight text-white">CpIPOS</p>
              <p className="text-sm font-semibold text-slate-400">Download Center</p>
            </div>
          </div>
          <p className="hidden text-xs font-bold uppercase tracking-[0.32em] text-slate-500 sm:block">Simple · Stable</p>
        </header>

        <section className="mx-auto mt-16 max-w-4xl text-center sm:mt-20">
          <div className="mx-auto mb-5 h-px w-20 bg-cyan-300" />
          <h1 className="text-5xl font-black tracking-tight text-white sm:text-7xl">
            ดาวน์โหลด <span className="bg-gradient-to-r from-sky-200 to-cyan-300 bg-clip-text text-transparent">CpIPOS</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-semibold text-slate-300">
            ไฟล์ดาวน์โหลดเวอร์ชันล่าสุดสำหรับ Windows และ Android
          </p>
        </section>

        <section className="mx-auto mt-12 grid w-full max-w-5xl gap-6 lg:grid-cols-2">
          <DownloadCard
            title="Windows Desktop"
            platform="สำหรับ Windows 10/11 x64"
            version={WINDOWS_VERSION}
            fileName={WINDOWS_FILE}
            href={WINDOWS_DOWNLOAD_URL}
            tone="windows"
          />
          <DownloadCard
            title="Android POS"
            platform="สำหรับ Android POS"
            version={ANDROID_VERSION}
            fileName={ANDROID_FILE}
            href={ANDROID_DOWNLOAD_URL}
            tone="android"
          />
        </section>

        <footer className="mt-auto pt-14 text-center text-sm font-semibold text-slate-500">© CpIPOS Download Center</footer>
      </div>
    </main>
  );
}

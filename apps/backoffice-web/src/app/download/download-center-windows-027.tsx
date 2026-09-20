"use client";

import Image from "next/image";

const WINDOWS_DOWNLOAD = "https://github.com/sstdevelopaminno/cp-ipos-desktop/releases/download/v0.3.3/CpIPOS.Desktop_0.3.3_x64-setup.exe";
const ANDROID_DOWNLOAD = "/download/android/mdm-rc-1-0-23";

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-9 w-9" fill="currentColor">
      <path d="M2 5.4 10.6 4v7.4H2V5.4Zm9.6-1.5L22 2.4v9H11.6V3.9ZM2 12.5h8.6v7.4L2 18.5v-6Zm9.6 0H22v9.1l-10.4-1.5v-7.6Z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-9 w-9" fill="none">
      <path d="m6 4-2-2m14 2 2-2M4 11a8 8 0 0 1 16 0H4Zm0 2v5a2 2 0 0 0 2 2h1v2m10-2h1a2 2 0 0 0 2-2v-5M7 13v7h10v-7M2 13v6m20-6v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="8.5" r=".8" fill="currentColor" />
      <circle cx="15" cy="8.5" r=".8" fill="currentColor" />
    </svg>
  );
}

export function DownloadCenterWindows027() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#061327] px-4 py-9 text-white sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -left-56 -top-72 h-[650px] w-[650px] rounded-full border border-sky-500/30 bg-sky-500/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-72 -right-52 h-[700px] w-[700px] rounded-full border border-blue-500/30 bg-blue-500/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100dvh-6rem)] w-full max-w-6xl flex-col">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-14 w-[76px] place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-lg shadow-black/20">
              <Image src="/brand/cpipos-logo.png" alt="โลโก้ CpIPOS" width={1448} height={1086} className="h-full w-full object-contain" priority />
            </div>
            <div className="border-l border-slate-600/60 pl-3">
              <p className="text-base font-black tracking-tight sm:text-lg">CpIPOS</p>
              <p className="text-[11px] font-semibold tracking-wide text-slate-400">Download Center</p>
            </div>
          </div>
          <a href="/login/store" className="rounded-xl border border-slate-600/70 px-3 py-2.5 text-xs font-bold text-slate-200 transition hover:border-sky-300/70 hover:text-sky-200 sm:px-4 sm:text-sm">เข้าใช้งาน POS ออนไลน์</a>
        </header>

        <section className="mx-auto mb-9 mt-14 max-w-3xl text-center sm:mb-12 sm:mt-20">
          <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.28em] text-sky-300">CpIPOS · Download</p>
          <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-6xl">ดาวน์โหลด <span className="text-sky-300">CpIPOS</span></h1>
          <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">เลือกไฟล์ติดตั้งสำหรับ Windows หรือ Android</p>
        </section>

        <section aria-label="ไฟล์ติดตั้ง CpIPOS" className="mx-auto grid w-full max-w-5xl gap-5 md:grid-cols-2 md:gap-6">
          <article className="flex min-w-0 flex-col rounded-[28px] border border-sky-400/45 bg-gradient-to-br from-[#123356]/95 via-[#101e39]/95 to-[#071426]/95 p-6 shadow-2xl shadow-sky-950/25 sm:p-8">
            <div className="flex items-start justify-between gap-3">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-sky-400/35 bg-sky-400/15 text-sky-200"><WindowsIcon /></div>
              <span className="rounded-full border border-sky-400/50 bg-sky-400/15 px-4 py-2 text-sm font-extrabold text-sky-100">v0.3.3</span>
            </div>
            <h2 className="mt-8 text-2xl font-black sm:text-3xl">Windows Desktop</h2>
            <p className="mt-2 text-sm text-slate-300">Windows 10/11 · x64</p>
            <p className="mt-7 break-all text-xs leading-6 text-slate-400">CpIPOS.Desktop_0.3.3_x64-setup.exe</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">พร้อมดาวน์โหลด</span>
              <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1.5 text-sky-200">Windows</span>
            </div>
            <a href={WINDOWS_DOWNLOAD} className="mt-8 inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-sky-300 px-5 py-4 text-sm font-black text-slate-950 shadow-lg shadow-sky-950/40 transition hover:bg-sky-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-100"><DownloadIcon />ดาวน์โหลด Windows</a>
          </article>

          <article className="flex min-w-0 flex-col rounded-[28px] border border-emerald-400/40 bg-gradient-to-br from-[#0f3540]/95 via-[#101e35]/95 to-[#071426]/95 p-6 shadow-2xl shadow-emerald-950/20 sm:p-8">
            <div className="flex items-start justify-between gap-3">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-emerald-400/35 bg-emerald-400/15 text-emerald-300"><AndroidIcon /></div>
              <span className="rounded-full border border-emerald-400/50 bg-emerald-400/15 px-4 py-2 text-sm font-extrabold text-emerald-100">v1.0.23</span>
            </div>
            <h2 className="mt-8 text-2xl font-black sm:text-3xl">Android POS</h2>
            <p className="mt-2 text-sm text-slate-300">Android · MDM Release Candidate</p>
            <p className="mt-7 break-all text-xs leading-6 text-slate-400">CpIPOS-Android-POS-1.0.23-MDM-RC-DEBUG.apk</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-amber-200">รุ่นทดสอบ · DEBUG</span>
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">Android</span>
            </div>
            <a href={ANDROID_DOWNLOAD} className="mt-8 inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-4 text-sm font-black text-emerald-950 shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100"><DownloadIcon />ดาวน์โหลด Android (ทดสอบ)</a>
          </article>
        </section>

        <footer className="mt-auto pt-12 text-center text-xs tracking-wide text-slate-500">CpIPOS Download Center</footer>
      </div>
    </main>
  );
}

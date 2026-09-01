"use client";

import { ANDROID_MODERN_RELEASE, ANDROID_STABLE_RELEASE } from "@/lib/android-runtime-release";

const WINDOWS_RUNTIME_LATEST_URL = "/download/windows-runtime/latest";

type AppIconKind = "tablet" | "phone" | "windows";

type AppCard = {
  title: string;
  platform: string;
  description: string;
  file: string;
  status: string;
  badge: string | null;
  buttonLabel: string | null;
  icon: AppIconKind;
  ready: boolean;
  href?: string;
  recommended?: boolean;
  legacy?: boolean;
};

const androidPosApps: AppCard[] = [
  {
    title: "CpIPOS POS - Modern Adaptive",
    platform: `Android POS · ${ANDROID_MODERN_RELEASE.versionName} · AUTO 1–2 จอ`,
    description: "เวอร์ชันมาตรฐานล่าสุดสำหรับร้านใหม่และเครื่อง POS ที่ต้องการฟีเจอร์ปัจจุบัน ใช้ APK เดียวสำหรับเครื่อง 1 จอหรือ 2 จอ โดย Android Runtime ตรวจจำนวนจอ จอรอง และขนาดหน้าจอจริง แล้วให้หน้า POS ปรับตาม viewport ของเครื่องอัตโนมัติ พร้อม Customer Display V2, Printer Verification, MDM และระบบอัปเดตแบบตรวจลายเซ็น",
    file: ANDROID_MODERN_RELEASE.assetName,
    status: `v${ANDROID_MODERN_RELEASE.versionName} · code ${ANDROID_MODERN_RELEASE.versionCode} · Modern Adaptive`,
    badge: `แนะนำ · v${ANDROID_MODERN_RELEASE.versionName}`,
    buttonLabel: `ดาวน์โหลด Modern ${ANDROID_MODERN_RELEASE.versionName}`,
    icon: "tablet",
    ready: true,
    href: ANDROID_MODERN_RELEASE.downloadPath,
    recommended: true
  },
  {
    title: "CpIPOS POS - Legacy Single Screen",
    platform: `Android POS · ${ANDROID_STABLE_RELEASE.versionName} · จอเดี่ยว / เครื่องเดิม`,
    description: "เวอร์ชัน Legacy Stable สำหรับเครื่องเก่าหรือร้านเดิมที่ติดตั้งแล้วและใช้งานเสถียร เหมาะกับจอเดี่ยวและงาน fallback เท่านั้น แยก channel จาก Modern ชัดเจน จึงไม่ถูกอัปเกรดข้ามสายโดยอัตโนมัติ และยังเก็บไฟล์เดิมไว้สำหรับงานซ่อมหรือ rollback",
    file: ANDROID_STABLE_RELEASE.assetName,
    status: `v${ANDROID_STABLE_RELEASE.versionName} · code ${ANDROID_STABLE_RELEASE.versionCode} · Legacy Single Screen`,
    badge: `Legacy only · v${ANDROID_STABLE_RELEASE.versionName}`,
    buttonLabel: `ดาวน์โหลด Legacy ${ANDROID_STABLE_RELEASE.versionName}`,
    icon: "tablet",
    ready: true,
    href: ANDROID_STABLE_RELEASE.downloadPath,
    legacy: true
  }
];

const otherApps: AppCard[] = [
  {
    title: "CpIPOS Mobile - Android",
    platform: "Android Phone / Tablet",
    description: "แอปสำหรับเจ้าของร้าน ผู้จัดการ และพนักงานบนมือถือ Android แยกจาก Android POS หน้าร้าน",
    file: "CpIPOS-Mobile.apk",
    status: "กำลังพัฒนา",
    badge: null,
    buttonLabel: null,
    icon: "phone",
    ready: false
  },
  {
    title: "CpIPOS POS - Windows",
    platform: "Windows POS Terminal · v0.1.9",
    description: "Windows POS Runtime สำหรับเครื่องขายหน้าร้าน พร้อมโหมดร้านชำ สแกน QR/Barcode/SKU, ตะกร้าขาย, offline queue, local runtime bridge และ printer/cash-drawer integration",
    file: "CpIPOS-WindowsRuntime-Setup.exe",
    status: "v0.1.9 Stable · พร้อมดาวน์โหลด",
    badge: "Windows Stable · v0.1.9",
    buttonLabel: "ดาวน์โหลด Windows POS 0.1.9",
    icon: "windows",
    ready: true,
    href: WINDOWS_RUNTIME_LATEST_URL
  }
];

function AppIcon({ kind }: { kind: AppIconKind }) {
  if (kind === "tablet") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
        <rect x="4" y="2.5" width="16" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 18.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "phone") {
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

function DownloadCard({ app }: { app: AppCard }) {
  const cardTone = app.recommended
    ? "border-emerald-400/45 bg-gradient-to-b from-emerald-950/45 via-sky-950/55 to-slate-900/95 shadow-emerald-950/30"
    : app.legacy
      ? "border-amber-400/25 bg-gradient-to-b from-amber-950/20 to-slate-900/90 shadow-black/20"
      : app.ready
        ? "border-sky-400/35 bg-gradient-to-b from-sky-950/70 to-slate-900/90 shadow-sky-950/30"
        : "border-slate-800 bg-slate-900/75 shadow-black/20";

  return (
    <article className={`relative flex min-h-[410px] flex-col overflow-hidden rounded-3xl border p-6 shadow-2xl sm:p-7 ${cardTone}`}>
      {app.badge ? (
        <div className={`absolute right-0 top-0 rounded-bl-2xl px-4 py-2 text-[11px] font-black uppercase tracking-wide ${app.recommended ? "bg-emerald-300 text-emerald-950" : app.legacy ? "bg-amber-300 text-amber-950" : "bg-sky-400 text-slate-950"}`}>
          {app.badge}
        </div>
      ) : null}

      <div className={`grid h-14 w-14 place-items-center rounded-2xl ${app.recommended ? "bg-emerald-400/15 text-emerald-300" : app.legacy ? "bg-amber-400/10 text-amber-200" : app.ready ? "bg-sky-400/15 text-sky-300" : "bg-slate-800 text-slate-300"}`}>
        <AppIcon kind={app.icon} />
      </div>

      <div className="mt-6">
        <p className={`text-xs font-extrabold uppercase tracking-[0.12em] ${app.recommended ? "text-emerald-300" : app.legacy ? "text-amber-200" : "text-sky-300"}`}>{app.platform}</p>
        <h2 className="mt-3 text-2xl font-black leading-tight text-white">{app.title}</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">{app.description}</p>
      </div>

      {app.recommended ? (
        <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-bold leading-6 text-emerald-100">
          APK เดียวสำหรับ 1–2 จอ · ตรวจจอรองอัตโนมัติ · ถ้าไม่มีจอรองจะทำงานเป็นจอเดี่ยวทันที ไม่ต้องติดตั้งคนละไฟล์
        </div>
      ) : null}

      {app.legacy ? (
        <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-bold leading-6 text-amber-100">
          ใช้สำหรับเครื่องเดิม/จอเดี่ยวที่ต้องคงความเข้ากันได้ · ไม่ใช้เป็นมาตรฐานร้านใหม่
        </div>
      ) : null}

      <div className="mt-5">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${app.recommended ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : app.legacy ? "border-amber-400/25 bg-amber-400/10 text-amber-200" : app.ready ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-400/20 bg-amber-400/10 text-amber-200"}`}>
          <span className={`h-2 w-2 rounded-full ${app.recommended ? "bg-emerald-400" : app.legacy ? "bg-amber-300" : app.ready ? "bg-emerald-400" : "bg-amber-400"}`} />
          {app.status}
        </span>
      </div>

      <div className="mt-auto pt-7">
        <p className="mb-4 truncate text-xs text-slate-500">ไฟล์: {app.file}</p>
        {app.ready && app.href && app.buttonLabel ? (
          <a href={app.href} className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-center text-sm font-black shadow-lg transition ${app.recommended ? "bg-emerald-300 text-emerald-950 shadow-emerald-950/40 hover:bg-emerald-200" : app.legacy ? "border border-amber-400/25 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20" : "bg-sky-400 text-slate-950 shadow-sky-950/40 hover:bg-sky-300"}`}>
            {app.buttonLabel}
          </a>
        ) : (
          <div className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 px-5 py-3 text-sm font-black text-slate-400">กำลังพัฒนา</div>
        )}
      </div>
    </article>
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

        <section className="mx-auto mt-14 max-w-5xl text-center sm:mt-20">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Android POS Standard · 2 Download Lanes
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl">ดาวน์โหลด CpIPOS Android POS</h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
            หน้า Download หลักมีเพียง <strong className="text-white">2 ตัวที่ใช้งานจริง</strong>: Modern Adaptive ทางซ้ายสำหรับมาตรฐานปัจจุบัน และ Legacy Single Screen ทางขวาสำหรับเครื่องเดิม
          </p>

          <div className="mx-auto mt-7 max-w-4xl rounded-3xl border border-emerald-400/25 bg-emerald-400/10 px-5 py-5 text-left sm:px-7">
            <p className="text-sm font-black uppercase tracking-[0.12em] text-emerald-300">เลือกเวอร์ชันอย่างไร</p>
            <div className="mt-3 grid gap-3 text-sm leading-7 text-slate-200 md:grid-cols-2">
              <div className="rounded-2xl border border-emerald-400/20 bg-slate-950/45 p-4">
                <strong className="text-emerald-300">Modern {ANDROID_MODERN_RELEASE.versionName} · แนะนำ</strong>
                <p className="mt-1 text-slate-300">ใช้กับร้านใหม่ เครื่องใหม่ และร้านที่อัปเกรดจาก Modern เดิม ระบบตรวจ 1/2 จอและปรับการแสดงผลอัตโนมัติ ไม่ต้องเลือก APK ตามความละเอียดหรือยี่ห้อเครื่อง</p>
              </div>
              <div className="rounded-2xl border border-amber-400/20 bg-slate-950/45 p-4">
                <strong className="text-amber-200">Legacy {ANDROID_STABLE_RELEASE.versionName} · จอเดี่ยว</strong>
                <p className="mt-1 text-slate-300">เก็บไว้สำหรับร้านเดิมหรือฮาร์ดแวร์เก่าที่ต้องคงพฤติกรรมเดิม ไม่ย้ายเข้า Modern channel เอง และไม่ใช้สำหรับร้านใหม่</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2 lg:mt-16">
          {androidPosApps.map((app) => <DownloadCard key={app.title} app={app} />)}
        </section>

        <section className="mx-auto mt-8 max-w-5xl rounded-2xl border border-sky-400/20 bg-sky-400/5 px-5 py-4 text-sm leading-7 text-sky-100">
          <strong className="text-white">การปรับตามหน้าจอ:</strong> Modern Runtime ตรวจ DisplayManager ของ Android เพื่อดูจำนวนจอและขนาดจริง จอหลักใช้ responsive viewport ของ Web POS ส่วนจอรองจะเปิด Customer Display V2 เฉพาะเมื่อระบบพบจอที่ใช้งานได้ หากจอรองถูกถอด ระบบจะกลับเป็นโหมดจอเดี่ยวโดยอัตโนมัติ
        </section>

        <section className="mx-auto mt-5 max-w-5xl rounded-2xl border border-amber-400/20 bg-amber-400/5 px-5 py-4 text-sm leading-7 text-amber-100">
          <strong className="text-white">นโยบายเวอร์ชัน:</strong> ไม่สร้าง APK แยกตามร้านหรือรุ่นเครื่องโดยไม่จำเป็น เวอร์ชันที่เผยแพร่แล้วจะไม่ถูกเขียนทับด้วยโค้ดคนละชุด รุ่นใหม่จะออกเฉพาะเมื่อมีการเปลี่ยน runtime ที่ต้องส่งถึงเครื่องจริง
        </section>

        <section className="mx-auto mt-14 max-w-5xl border-t border-slate-800 pt-10">
          <div className="mb-6">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Other applications</p>
            <h2 className="mt-2 text-2xl font-black text-white">แอปอื่นของ CpIPOS</h2>
            <p className="mt-2 text-sm text-slate-400">รายการด้านล่างไม่ใช่ตัวเลือกสำหรับติดตั้ง Android POS หน้าร้าน</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {otherApps.map((app) => <DownloadCard key={app.title} app={app} />)}
          </div>
        </section>

        <section className="mx-auto mt-8 max-w-5xl rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-4 text-center text-sm leading-7 text-emerald-100">
          <strong>Release policy:</strong> Modern {ANDROID_MODERN_RELEASE.versionName} / code {ANDROID_MODERN_RELEASE.versionCode} คือสายมาตรฐานแบบ Adaptive 1–2 จอ ส่วน Legacy {ANDROID_STABLE_RELEASE.versionName} / code {ANDROID_STABLE_RELEASE.versionCode} เป็นสายจอเดี่ยวสำหรับร้านเดิมเท่านั้น
        </section>
      </div>
    </main>
  );
}

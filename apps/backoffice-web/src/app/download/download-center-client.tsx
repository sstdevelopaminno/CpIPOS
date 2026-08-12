"use client";

import { useEffect, useState } from "react";

type ProductStatus = "ready" | "developing";

type Product = {
  title: string;
  platform: string;
  description: string;
  status: ProductStatus;
  statusLabel: string;
  file: string;
  downloadUrl?: string;
  downloadLabel: string;
  modalBody?: string;
  icon: "mobile" | "tablet" | "windows" | "admin";
};

const products: Product[] = [
  {
    title: "CpIPOS POS - Android Tablet",
    platform: "Android Tablet POS · v1.0.4",
    description:
      "CpIPOS Android POS 1.0.4 Stable สำหรับเครื่องขายหน้าร้านบน Android Tablet พร้อม stable signing, Native Print Agent และแก้ HTML receipt raster ไม่ให้จบด้วย bitmap ว่าง/ความสูง 1px บนเครื่อง POS จริง",
    status: "ready",
    statusLabel: "1.0.4 Stable · พร้อมดาวน์โหลด",
    file: "CpIPOS-Android-POS-1.0.4.apk",
    downloadUrl: "/download/android/latest",
    downloadLabel: "Android POS 1.0.4",
    icon: "tablet"
  },
  {
    title: "CpIPOS Mobile - Android",
    platform: "Android Phone / Tablet",
    description:
      "แอปสำหรับเจ้าของร้าน ผู้จัดการ และพนักงานบนมือถือ Android แยกจาก Android POS หน้าร้าน",
    status: "developing",
    statusLabel: "กำลังพัฒนา",
    file: "CpIPOS-Mobile.apk",
    downloadLabel: "CpIPOS Mobile",
    modalBody:
      "CpIPOS Mobile - Android ยังไม่เปิดให้ดาวน์โหลดจากหน้าเว็บหลักในรอบนี้ เพื่อป้องกันผู้ใช้สับสนกับ Android POS ที่เป็นงานหลักใกล้ปิดตอนนี้",
    icon: "mobile"
  },
  {
    title: "CpIPOS POS - Windows",
    platform: "Windows POS Terminal",
    description:
      "Windows POS Runtime สำหรับเครื่องขายหน้าร้าน รองรับ WebView2 shell, local runtime bridge, printer/cash-drawer integration และงานเครื่อง POS Windows",
    status: "developing",
    statusLabel: "กำลังพัฒนา",
    file: "CpIPOS-WindowsRuntime-Setup.exe",
    downloadLabel: "Windows POS",
    modalBody:
      "CpIPOS POS - Windows ยังถูกปิดไว้เป็นสถานะกำลังพัฒนาใน Download Center จนกว่าจะผ่าน QA และพร้อมปล่อยใช้งานจริง",
    icon: "windows"
  },
  {
    title: "CpIPOS IT Admin Runtime",
    platform: "Windows IT Admin",
    description:
      "Windows Runtime สำหรับงาน IT Admin, device management, diagnostics และ MDM operation แยกจากเครื่อง POS หน้าร้าน",
    status: "developing",
    statusLabel: "กำลังพัฒนา",
    file: "CpIPOS-ITAdminRuntime-Setup.exe",
    downloadLabel: "IT Admin",
    modalBody:
      "CpIPOS IT Admin Runtime ยังถูกปิดไว้เป็นสถานะกำลังพัฒนาใน Download Center จนกว่าจะพร้อมเปิดให้ใช้งานจริง",
    icon: "admin"
  }
];

function ProductIcon({ type }: { type: Product["icon"] }) {
  if (type === "windows") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
        <path d="M3 5.2 10.5 4v7H3V5.2ZM11.5 3.8 21 2.4V11h-9.5V3.8ZM3 12h7.5v7L3 17.8V12Zm8.5 0H21v9.6l-9.5-1.4V12Z" fill="currentColor" />
      </svg>
    );
  }

  if (type === "tablet") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
        <rect x="4" y="2.5" width="16" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 18.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "admin") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
        <path d="M12 3 5 6v5c0 4.3 2.7 8.2 7 10 4.3-1.8 7-5.7 7-10V6l-7-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9.2 12.1 11 13.9l3.9-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
      <rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 18.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadCenterClient() {
  const [modalProduct, setModalProduct] = useState<Product | null>(null);

  useEffect(() => {
    if (!modalProduct) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalProduct(null);
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [modalProduct]);

  return (
    <main className="min-h-dvh overflow-y-auto bg-[radial-gradient(circle_at_top,_#0b2447_0%,_#061227_34%,_#020617_72%)] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sm font-black text-sky-300 shadow-lg shadow-sky-950/30">
              CP
            </div>
            <div>
              <p className="font-black tracking-tight text-white">CpIPOS</p>
              <p className="text-xs text-slate-400">Download Center</p>
            </div>
          </div>

          <a
            href="/login/store"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 px-4 text-sm font-bold text-slate-100 transition hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-200"
          >
            เข้าใช้งาน Web App
          </a>
        </header>

        <section className="mx-auto mt-16 max-w-4xl text-center sm:mt-20">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] text-sky-300">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            CpIPOS Applications
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl">
            ดาวน์โหลด Android POS
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            เปิดดาวน์โหลด CpIPOS POS - Android Tablet เวอร์ชัน 1.0.4 Stable สำหรับเครื่องขายหน้าร้าน ส่วน Mobile, Windows POS และ IT Admin ยังปิดไว้เป็นสถานะกำลังพัฒนา
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3 text-xs font-semibold">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">
              Android POS 1.0.4 Stable พร้อมดาวน์โหลด
            </span>
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-amber-200">
              รุ่นอื่นกำลังพัฒนา
            </span>
          </div>
        </section>

        <section className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4 lg:mt-16">
          {products.map((product) => {
            const ready = product.status === "ready";

            return (
              <article
                key={product.title}
                className={`group relative flex min-h-[390px] flex-col overflow-hidden rounded-3xl border p-6 shadow-2xl transition duration-300 sm:p-7 ${
                  ready
                    ? "border-sky-400/35 bg-gradient-to-b from-sky-950/70 to-slate-900/90 shadow-sky-950/30 hover:-translate-y-1 hover:border-sky-400/60"
                    : "border-slate-800 bg-slate-900/75 shadow-black/20 hover:-translate-y-1 hover:border-slate-700"
                }`}
              >
                {ready ? (
                  <div className="absolute right-0 top-0 rounded-bl-2xl bg-sky-400 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-slate-950">
                    Latest
                  </div>
                ) : null}

                <div className={`grid h-14 w-14 place-items-center rounded-2xl ${ready ? "bg-sky-400/15 text-sky-300" : "bg-slate-800 text-slate-300"}`}>
                  <ProductIcon type={product.icon} />
                </div>

                <div className="mt-6">
                  <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-sky-300">{product.platform}</p>
                  <h2 className="mt-3 text-2xl font-black leading-tight text-white">{product.title}</h2>
                  <p className="mt-4 text-sm leading-7 text-slate-300">{product.description}</p>
                </div>

                <div className="mt-5">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                      ready
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : "border-amber-400/20 bg-amber-400/10 text-amber-200"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${ready ? "bg-emerald-400" : "bg-amber-400"}`} />
                    {product.statusLabel}
                  </span>
                </div>

                <div className="mt-auto pt-7">
                  <p className="mb-4 truncate text-xs text-slate-500">ไฟล์: {product.file}</p>

                  {ready && product.downloadUrl ? (
                    <a
                      href={product.downloadUrl}
                      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-sky-950/40 transition hover:bg-sky-300"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                        <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      ดาวน์โหลด {product.downloadLabel}
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setModalProduct(product)}
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 px-5 py-3 text-sm font-black text-slate-100 transition hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-100"
                    >
                      ดูสถานะการพัฒนา
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 px-5 py-4 text-center text-sm text-slate-400">
          ต้องการใช้งานทันที? <a href="/login/store" className="font-bold text-sky-300 hover:text-sky-200">เปิด CpIPOS Web App</a> ได้จากทุกอุปกรณ์ที่มีเบราว์เซอร์
        </section>
      </div>

      {modalProduct ? (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setModalProduct(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="development-modal-title"
            className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl shadow-black/60 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-400/10 text-amber-300">
                <ProductIcon type={modalProduct.icon} />
              </div>
              <button
                type="button"
                onClick={() => setModalProduct(null)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-slate-700 text-xl text-slate-400 transition hover:bg-slate-800 hover:text-white"
                aria-label="ปิดหน้าต่าง"
              >
                ×
              </button>
            </div>

            <span className="mt-6 inline-flex rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-200">
              กำลังพัฒนา
            </span>
            <h2 id="development-modal-title" className="mt-4 text-2xl font-black text-white">
              {modalProduct.title}
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">{modalProduct.modalBody}</p>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setModalProduct(null)}
                className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-4 text-sm font-bold text-slate-200 transition hover:bg-slate-700"
              >
                ปิดหน้าต่าง
              </button>
              <a
                href="/login/store"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sky-400 px-4 text-sm font-black text-slate-950 transition hover:bg-sky-300"
              >
                ใช้งานผ่าน Web App
              </a>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

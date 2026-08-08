const products = [
  {
    title: "CpIPOS Mobile - Android",
    platform: "Android phone/tablet",
    description: "Native Android app for owner, manager, and staff workflows. No WebView; uses CpIPOS server APIs and secure session cookies.",
    downloadUrl: "/download/mobile/latest",
    file: "CpIPOS-Mobile.apk"
  },
  {
    title: "CpIPOS POS - Android Tablet",
    platform: "Android tablet POS",
    description: "Native Kotlin + Jetpack Compose tablet POS for cashier use. Server APIs remain authoritative for login, device, shift, order, payment, and stock behavior.",
    downloadUrl: "/download/android/latest",
    file: "CpIPOS-Android-debug.apk"
  },
  {
    title: "CpIPOS POS - Windows",
    platform: "Windows POS terminal",
    description: "Windows POS runtime with local printer, cash drawer, network, diagnostics, and update foundation. Native UI migration is in progress.",
    downloadUrl: "/download/windows-runtime/latest",
    file: "CpIPOS-WindowsRuntime-Setup.exe"
  }
] as const;

export const metadata = {
  title: "Download CpIPOS",
  description: "Unified customer download center for CpIPOS Mobile Android, Tablet Android POS, and Windows POS."
};

export default function CpiposDownloadCenterPage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-10 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black tracking-tight text-white">CpIPOS</p>
            <p className="mt-1 text-xs text-slate-500">Download Center</p>
          </div>
          <a
            href="/login/store"
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-3.5 py-2 text-xs font-semibold text-slate-300 transition hover:border-sky-700 hover:text-sky-200"
          >
            Web Trial
          </a>
        </header>

        <section className="max-w-3xl">
          <p className="mb-4 inline-flex rounded-lg border border-sky-800 bg-sky-950/60 px-3 py-1 text-xs font-bold uppercase text-sky-300">
            CpIPOS Downloads
          </p>
          <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            Download CpIPOS apps
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg">
            One customer-facing download page for the three CpIPOS products. Legacy detail URLs redirect here; app updater URLs under `/latest` stay stable.
          </p>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-3">
          {products.map((product) => (
            <article
              key={product.downloadUrl}
              className="flex min-h-[300px] flex-col rounded-lg border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/10"
            >
              <div>
                <p className="text-xs font-bold uppercase text-sky-300">{product.platform}</p>
                <h2 className="mt-3 text-2xl font-black text-white">{product.title}</h2>
                <p className="mt-4 text-sm leading-7 text-slate-300">{product.description}</p>
              </div>

              <div className="mt-auto pt-6">
                <p className="mb-4 text-xs text-slate-500">File: {product.file}</p>
                <a
                  href={product.downloadUrl}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-sky-400"
                >
                  Download
                </a>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
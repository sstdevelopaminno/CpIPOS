const products = [
  {
    eyebrow: "CpIPOS Mobile",
    title: "CpIPOS Mobile",
    platform: "Android • มือถือและแท็บเล็ต",
    description:
      "แอป Native Android สำหรับ Owner / Manager / Staff ใช้งาน CpIPOS บนมือถือและแท็บเล็ต โดยไม่ใช้ WebView",
    pageUrl: "/download/mobile",
    downloadUrl: "/download/mobile/latest",
    downloadLabel: "ดาวน์โหลด APK",
    file: "CpIPOS-Mobile.apk"
  },
  {
    eyebrow: "CpIPOS Android POS",
    title: "CpIPOS Android POS",
    platform: "Android • แท็บเล็ต POS",
    description:
      "แอปสำหรับแท็บเล็ต POS แบบเต็มจอแนวนอน ใช้สำหรับหน้าขายและการทำงานบนเครื่องแคชเชียร์ Android",
    pageUrl: "/download/android",
    downloadUrl: "/download/android/latest",
    downloadLabel: "ดาวน์โหลด APK",
    file: "CpIPOS-Android-debug.apk"
  },
  {
    eyebrow: "CpIPOS Windows",
    title: "CpIPOS Windows Runtime",
    platform: "Windows • เครื่อง POS",
    description:
      "ตัวติดตั้งสำหรับเครื่อง POS Windows พร้อม WebView2 และ Local Print Bridge สำหรับเครื่องพิมพ์และลิ้นชักเก็บเงิน",
    pageUrl: "/download/windows-runtime",
    downloadUrl: "/download/windows-runtime/latest",
    downloadLabel: "ดาวน์โหลดตัวติดตั้ง",
    file: "CpIPOS-WindowsRuntime-Setup.exe"
  },
  {
    eyebrow: "CpIPOS IT Admin",
    title: "CpIPOS IT Admin",
    platform: "Windows • ทีม IT",
    description:
      "โปรแกรมสำหรับทีม IT ใช้จัดการร้านค้า สาขา แพ็กเกจ อุปกรณ์ และงานดูแลระบบ CpIPOS",
    pageUrl: "/download/it-admin",
    downloadUrl: "/download/it-admin/latest",
    downloadLabel: "ดาวน์โหลดตัวติดตั้ง",
    file: "CpIPOS-ITAdminRuntime-Setup.exe"
  }
] as const;

export const metadata = {
  title: "ดาวน์โหลด CpIPOS",
  description: "ศูนย์ดาวน์โหลด CpIPOS Mobile, Android POS, Windows Runtime และ IT Admin"
};

export default function CpiposDownloadCenterPage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-slate-950 text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_15%_-10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_85%_0%,rgba(14,116,144,0.16),transparent_40%)]"
      />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-12 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black tracking-tight text-white">CpIPOS</p>
            <p className="mt-1 text-xs text-slate-500">Download Center</p>
          </div>
          <a
            href="https://cp-ipos-web.vercel.app"
            className="rounded-full border border-slate-700 bg-slate-900/60 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-sky-700 hover:text-sky-200"
          >
            ไปที่ CpIPOS Web
          </a>
        </header>

        <section className="max-w-3xl">
          <p className="mb-4 inline-flex rounded-full border border-sky-800 bg-sky-950/60 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-sky-300">
            CpIPOS Downloads
          </p>
          <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            ดาวน์โหลดแอป CpIPOS สำหรับอุปกรณ์ของคุณ
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg">
            รวมหน้าดาวน์โหลด CpIPOS Mobile, Android POS, Windows Runtime และ IT Admin ไว้ในที่เดียว
            เลือกผลิตภัณฑ์ที่ต้องการเพื่อดูรายละเอียดการติดตั้ง หรือดาวน์โหลดไฟล์ล่าสุดได้ทันที
          </p>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          {products.map((product) => (
            <article
              key={product.pageUrl}
              className="flex min-h-[310px] flex-col rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/10"
            >
              <div>
                <p className="inline-flex rounded-full border border-sky-800 bg-sky-950/60 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-300">
                  {product.eyebrow}
                </p>
                <h2 className="mt-4 text-2xl font-black text-white">{product.title}</h2>
                <p className="mt-1 text-sm font-semibold text-sky-300">{product.platform}</p>
                <p className="mt-4 text-sm leading-7 text-slate-300">{product.description}</p>
              </div>

              <div className="mt-auto pt-6">
                <p className="mb-4 text-xs text-slate-500">ไฟล์: {product.file}</p>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={product.downloadUrl}
                    className="inline-flex items-center justify-center rounded-2xl bg-sky-500 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-sky-400"
                  >
                    ↓ {product.downloadLabel}
                  </a>
                  <a
                    href={product.pageUrl}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/50 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-sky-700 hover:text-sky-200"
                  >
                    ดูรายละเอียด
                  </a>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border border-sky-800/70 bg-sky-950/30 p-5 text-sm leading-7 text-sky-100 sm:p-6">
          <p className="font-bold text-sky-200">ลิงก์ดาวน์โหลดคงที่</p>
          <p className="mt-1">
            ปุ่มดาวน์โหลดแต่ละรายการใช้เส้นทาง /latest ของ CpIPOS Web แล้ว redirect ไปยังไฟล์ Release ล่าสุด
            ทำให้ลูกค้าสามารถใช้ลิงก์เดิมได้เมื่อมีเวอร์ชันใหม่
          </p>
        </section>

        <footer className="mt-12 border-t border-slate-800 pt-6 text-xs text-slate-500">
          © CpIPOS — Download Center
        </footer>
      </div>
    </main>
  );
}

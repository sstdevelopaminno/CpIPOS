import Link from "next/link";

export function FinanceSectionHeader({ title, subtitle, group }: {
  title: string; subtitle?: string; group?: "more" | "settings";
}) {
  return (
    <header className="w-full min-w-0 border-b border-[#a9c5e6] bg-[#155c94] px-4 py-3 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-sky-100">
            <Link href="/finance" className="hover:underline">การเงิน</Link>
            {group ? " / " + (group === "more" ? "เพิ่มเติม" : "ตั้งค่า") : "" }
          </p>
          <h1 className="mt-1 text-lg font-bold leading-tight">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-xs text-sky-100">{subtitle}</p> : null}
        </div>
        <span className="rounded border border-sky-200/40 px-2 py-1 text-[11px] font-semibold text-white/90">
          ฝ่ายบัญชี
        </span>
      </div>
    </header>
  );
}

import Image from "next/image";

export function AuthShell({ children }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center overflow-y-auto bg-[#eef3f8] px-3 py-4">
      <section className="w-full max-w-[444px] rounded-[18px] border border-[#cfdff2] bg-white px-5 pb-6 pt-16 shadow-sm">
        <div className="mb-10 flex justify-center">
          <Image
            src="/brand/cpipos-logo.png"
            alt="CpIPOS"
            width={240}
            height={170}
            priority
            className="h-auto w-[156px] object-contain"
          />
        </div>

        {children}
      </section>
    </main>
  );
}

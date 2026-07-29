import type { ReactNode } from "react";
import type { Viewport } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PosShiftCycleGuard } from "@/components/pos/pos-shift-cycle-guard";
import { PosRoutePerformanceTracker } from "@/components/pos-preview/pos-route-performance-tracker";
import { PosShellSidebar } from "@/components/pos-preview/pos-shell-sidebar";
import { PosViewportGuard } from "@/components/pos-preview/pos-viewport-guard";
import { getCurrentLanguage, t } from "@/lib/i18n";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover"
};

function resolvePosSessionCookieNames() {
  const handoffName = String(process.env.POS_SESSION_COOKIE_NAME ?? "pos_session_handoff").trim() || "pos_session_handoff";
  const sessionIdName = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";

  return { handoffName, sessionIdName };
}

export default async function PosPreviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const { handoffName, sessionIdName } = resolvePosSessionCookieNames();
  const hasPosSession = Boolean(cookieStore.get(sessionIdName)?.value || cookieStore.get(handoffName)?.value);

  if (!hasPosSession) {
    redirect("/login/store");
  }

  const lang = await getCurrentLanguage();

  return (
    <main className="pos-app-root flex h-screen w-screen overflow-hidden bg-slate-50">
      <PosRoutePerformanceTracker />
      <PosShiftCycleGuard lang={lang} />
      <PosViewportGuard lang={lang} />

      <div className="pos-app-frame flex h-full min-h-0 w-full overflow-hidden">
        <PosShellSidebar
          lang={lang}
          settingsLabel={t(lang, "common_settings")}
        />

        <section className="pos-app-content-area flex min-h-0 min-w-0 flex-1 overflow-hidden py-4 pl-4 pr-2 lg:pl-5 lg:pr-3">
          {children}
        </section>
      </div>
    </main>
  );
}

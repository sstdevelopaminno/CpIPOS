import type { ReactNode } from "react";
import type { Viewport } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PosShiftCycleGuard } from "@/components/pos/pos-shift-cycle-guard";
import { PosDeviceHeartbeatSender } from "@/components/pos/pos-device-heartbeat-sender";
import { PosShellFrame } from "@/components/pos-preview/pos-shell-frame";
import { PosRoutePerformanceTracker } from "@/components/pos-preview/pos-route-performance-tracker";
import { PosTableQrGlobalAlert } from "@/components/pos-preview/pos-table-qr-global-alert";
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

export default async function PosPreviewLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const { handoffName, sessionIdName } = resolvePosSessionCookieNames();
  const hasPosSession = Boolean(cookieStore.get(sessionIdName)?.value || cookieStore.get(handoffName)?.value);
  if (!hasPosSession) redirect("/login/store");

  const lang = await getCurrentLanguage();
  return (
    <main className="pos-app-root flex h-screen w-screen overflow-hidden bg-slate-50">
      <PosRoutePerformanceTracker />
      <PosShiftCycleGuard lang={lang} />
      <PosDeviceHeartbeatSender />
      <PosViewportGuard lang={lang} />
      <PosTableQrGlobalAlert lang={lang} />
      <PosShellFrame lang={lang} settingsLabel={t(lang, "common_settings")}>
        {children}
      </PosShellFrame>
    </main>
  );
}

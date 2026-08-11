import type { ReactNode } from "react";
import type { Viewport } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PosShiftCycleGuard } from "@/components/pos/pos-shift-cycle-guard";
import { PosDeviceHeartbeatSender } from "@/components/pos/pos-device-heartbeat-sender";
import { PosProductMediaToolbarLink } from "@/components/pos-preview/pos-product-media-toolbar-link";
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

const POS_MAIN_MENU_PLACEMENT_KEY = "pos_main_menu_bar_position_v2";

type MainMenuPlacement = "left" | "top" | "bottom";

function resolvePosSessionCookieNames() {
  const handoffName = String(process.env.POS_SESSION_COOKIE_NAME ?? "pos_session_handoff").trim() || "pos_session_handoff";
  const sessionIdName = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";
  return { handoffName, sessionIdName };
}

function parseMenuPlacement(value: string | null | undefined): MainMenuPlacement | null {
  if (value === "left" || value === "top" || value === "bottom") return value;
  return null;
}

function isAndroidPosUserAgent(userAgent: string): boolean {
  return userAgent.includes("CpIPOS-AndroidPOS/") || userAgent.includes("CpIPOS-Tablet/");
}

export default async function PosPreviewLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const { handoffName, sessionIdName } = resolvePosSessionCookieNames();
  const hasPosSession = Boolean(cookieStore.get(sessionIdName)?.value || cookieStore.get(handoffName)?.value);
  if (!hasPosSession) redirect("/login/store");

  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent") ?? "";
  const storedPlacement = parseMenuPlacement(cookieStore.get(POS_MAIN_MENU_PLACEMENT_KEY)?.value);
  const initialPlacement: MainMenuPlacement = storedPlacement ?? (isAndroidPosUserAgent(userAgent) ? "top" : "left");

  const lang = await getCurrentLanguage();
  return (
    <main className="pos-app-root flex h-screen w-screen overflow-hidden bg-slate-50">
      <PosRoutePerformanceTracker />
      <PosShiftCycleGuard lang={lang} />
      <PosDeviceHeartbeatSender />
      <PosProductMediaToolbarLink th={lang === "th"} />
      <PosViewportGuard lang={lang} />
      <PosTableQrGlobalAlert lang={lang} />
      <PosShellFrame lang={lang} settingsLabel={t(lang, "common_settings")} initialPlacement={initialPlacement}>
        {children}
      </PosShellFrame>
    </main>
  );
}

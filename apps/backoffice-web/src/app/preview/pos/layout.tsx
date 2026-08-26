import type { ReactNode } from "react";
import type { Viewport } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PosShiftCycleGuard } from "@/components/pos/pos-shift-cycle-guard";
import { PosDeviceHeartbeatSender } from "@/components/pos/pos-device-heartbeat-sender";
import { PosFf0001SalesModeGuard } from "@/components/pos/pos-ff0001-sales-mode-guard";
import { PosBuffetToolsBridge } from "@/components/pos-preview/pos-buffet-tools-bridge";
import { PosProductMediaToolbarLink } from "@/components/pos-preview/pos-product-media-toolbar-link";
import { PosShellFrame } from "@/components/pos-preview/pos-shell-frame";
import { PosRoutePerformanceTracker } from "@/components/pos-preview/pos-route-performance-tracker";
import { PosTableQrGlobalAlert } from "@/components/pos-preview/pos-table-qr-global-alert";
import { PosViewportGuard } from "@/components/pos-preview/pos-viewport-guard";
import { getCurrentLanguage, t } from "@/lib/i18n";
import { loadPosRuntimeDevicePolicyForSession } from "@/lib/pos-device-status";
import { requirePosSession } from "@/lib/pos-session-guard";

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

function PosMdmMaintenanceLock({ deviceCode }: { deviceCode: string | null }) {
  return (
    <main className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-slate-950 p-6 text-slate-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_48%)]" />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pos-maintenance-lock-title"
        className="relative z-10 w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-2xl"
      >
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl" aria-hidden="true">
          🔒
        </div>
        <p className="mb-2 text-sm font-extrabold uppercase tracking-[0.2em] text-amber-700">MDM MAINTENANCE LOCK</p>
        <h1 id="pos-maintenance-lock-title" className="text-3xl font-black text-slate-950">
          เครื่อง POS ถูกล็อกชั่วคราว
        </h1>
        <p className="mt-4 text-lg font-bold text-slate-700">
          ระบบอยู่ระหว่างตรวจสอบ แก้ไข และปรับปรุงหลังร้านปิด
        </p>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-left text-base font-semibold leading-7 text-amber-950">
          <p>• กรุณาอย่าทำรายการขาย ชำระเงิน หรือเปิดบิลใหม่</p>
          <p>• กรุณาอย่าปิดเครื่องหรือถอดเครือข่ายระหว่างการบำรุงรักษา</p>
          <p>• หน้าจอนี้จะถูกปลดล็อกโดยผู้ดูแลระบบผ่าน MDM เท่านั้น</p>
        </div>
        <p className="mt-6 text-sm font-bold text-slate-500">
          เครื่อง: {deviceCode || "POS"} · สถานะ: LOCKED
        </p>
      </section>
    </main>
  );
}

export default async function PosPreviewLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const { handoffName, sessionIdName } = resolvePosSessionCookieNames();
  const hasPosSession = Boolean(cookieStore.get(sessionIdName)?.value || cookieStore.get(handoffName)?.value);
  if (!hasPosSession) redirect("/login/store");

  const scope = await requirePosSession().catch(() => null);
  if (!scope) redirect("/login/store");

  const devicePolicy = await loadPosRuntimeDevicePolicyForSession(scope.session);
  if (devicePolicy.block_sales) {
    return <PosMdmMaintenanceLock deviceCode={devicePolicy.code ?? scope.session.device_code ?? null} />;
  }

  const sessionRole = String(scope.session.role ?? "").trim().toLowerCase();
  const isKitchen = sessionRole === "kitchen";

  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent") ?? "";
  const storedPlacement = parseMenuPlacement(cookieStore.get(POS_MAIN_MENU_PLACEMENT_KEY)?.value);
  const managedPlacement = parseMenuPlacement(devicePolicy.main_menu_placement);
  const initialPlacement: MainMenuPlacement =
    managedPlacement ?? storedPlacement ?? (isAndroidPosUserAgent(userAgent) ? "top" : "left");

  const lang = await getCurrentLanguage();
  return (
    <main className="pos-app-root flex h-screen w-screen overflow-hidden bg-slate-50">
      <PosRoutePerformanceTracker />
      {!isKitchen ? <PosShiftCycleGuard lang={lang} /> : null}
      {!isKitchen ? <PosDeviceHeartbeatSender /> : null}
      {!isKitchen ? <PosFf0001SalesModeGuard /> : null}
      {!isKitchen ? <PosProductMediaToolbarLink th={lang === "th"} /> : null}
      {!isKitchen ? <PosBuffetToolsBridge th={lang === "th"} /> : null}
      <PosViewportGuard lang={lang} />
      {!isKitchen ? <PosTableQrGlobalAlert lang={lang} /> : null}
      <PosShellFrame
        lang={lang}
        settingsLabel={t(lang, "common_settings")}
        initialPlacement={initialPlacement}
        managedPlacement={managedPlacement}
        sessionRole={sessionRole}
      >
        {children}
      </PosShellFrame>
    </main>
  );
}

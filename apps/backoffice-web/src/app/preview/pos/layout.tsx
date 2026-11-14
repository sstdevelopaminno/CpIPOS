import type { ReactNode } from "react";
import type { Viewport } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PosShiftCycleGuard } from "@/components/pos/pos-shift-cycle-guard";
import { PosDeviceHeartbeatSender } from "@/components/pos/pos-device-heartbeat-sender";
import { PosFf0001SalesModeGuard } from "@/components/pos/pos-ff0001-sales-mode-guard";
import { PosSalesModePolicyController } from "@/components/pos/pos-sales-mode-policy-controller";
import { PosBuffetToolsBridge } from "@/components/pos-preview/pos-buffet-tools-bridge";
import { PosProductMediaToolbarLink } from "@/components/pos-preview/pos-product-media-toolbar-link";
import { PosShellFrame } from "@/components/pos-preview/pos-shell-frame";
import { PosSubscriptionLifecycleGuard } from "@/components/pos-preview/pos-subscription-lifecycle-guard";
import { PosRoutePerformanceTracker } from "@/components/pos-preview/pos-route-performance-tracker";
import { PosTableQrGlobalAlert } from "@/components/pos-preview/pos-table-qr-global-alert";
import { PosSupportNotifier } from "@/components/pos-preview/pos-support-notifier";
import { PosViewportGuard } from "@/components/pos-preview/pos-viewport-guard";
import { getCurrentLanguage, t } from "@/lib/i18n";
import { loadPosRuntimeDevicePolicyForSession } from "@/lib/pos-device-status";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSubscriptionLifecycleGuard } from "@/lib/services/pos-subscription-lifecycle-guard-service";

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
  if (!hasPosSession) redirect("/login/store?from=pos-session");

  // A temporary database/runtime lookup failure is not an invalid customer session.
  // Redirecting on all failures can bounce between /preview/pos and /login/store:
  // the login screen independently checks /api/pos/session/current and sends the
  // customer back here when it succeeds. Only real 401s should send them to login.
  let scope: Awaited<ReturnType<typeof requirePosSession>> | null = null;
  let sessionCheckProblem: string | null = null;
  try {
    scope = await requirePosSession();
  } catch (error) {
    if (error instanceof PosGuardError && error.status === 401) {
      redirect("/login/store?from=pos-session");
    }
    sessionCheckProblem = error instanceof PosGuardError
      ? error.code
      : "session_check_unavailable";
    console.warn("[pos-layout] session verification unavailable; avoiding login redirect", {
      code: sessionCheckProblem
    });
  }
  if (!scope) {
    const isSubscriptionLocked = sessionCheckProblem === "subscription_access_locked";
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-slate-50 p-5 text-slate-900">
        <section role="alert" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
          <h1 className="text-xl font-bold">
            {isSubscriptionLocked ? "แพ็กเกจถูกระงับการใช้งาน" : "ไม่สามารถตรวจสอบการเชื่อมต่อ POS ได้ชั่วคราว"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {isSubscriptionLocked
              ? "กรุณาติดต่อฝ่าย IT เพื่อตรวจสอบสถานะแพ็กเกจก่อนใช้งาน"
              : "ระบบยังไม่ได้ยืนยันว่า Session ของท่านหมดอายุ จึงไม่สั่งออกจากระบบอัตโนมัติ"}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white" href="/preview/pos?retry=1">
              ตรวจสอบอีกครั้ง
            </a>
            <a className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold" href="/login/store?from=pos-session">
              เข้าสู่ระบบใหม่
            </a>
          </div>
        </section>
      </main>
    );
  }

  const devicePolicy = await loadPosRuntimeDevicePolicyForSession(scope.session);
  const subscriptionGuard = await loadPosSubscriptionLifecycleGuard(scope.session.tenant_id).catch(() => null);
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
      {!isKitchen ? <PosShiftCycleGuard lang={lang === "lo" ? "en" : lang} /> : null}
      {!isKitchen ? <PosDeviceHeartbeatSender /> : null}
      {!isKitchen ? <PosFf0001SalesModeGuard /> : null}
      {!isKitchen ? <PosSalesModePolicyController /> : null}
      {!isKitchen ? <PosProductMediaToolbarLink th={lang === "th"} /> : null}
      {!isKitchen ? <PosBuffetToolsBridge th={lang === "th"} /> : null}
      <PosViewportGuard lang={lang === "lo" ? "en" : lang} />
      {!isKitchen ? <PosTableQrGlobalAlert lang={lang} /> : null}
      {!isKitchen ? <PosSubscriptionLifecycleGuard initial={subscriptionGuard} /> : null}
      {!isKitchen ? <PosSupportNotifier /> : null}
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

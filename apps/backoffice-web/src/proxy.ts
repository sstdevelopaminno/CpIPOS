import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type SupabaseCookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

const POS_BACKOFFICE_AUTH_COMPAT_PATHS = new Set([
  "/api/backoffice/catalog",
  "/api/backoffice/stock/settings"
]);

function resolvePosSessionCookieNames() {
  const handoffName = String(process.env.POS_SESSION_COOKIE_NAME ?? "pos_session_handoff").trim() || "pos_session_handoff";
  const sessionIdName = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";

  return { handoffName, sessionIdName };
}

function isSameOriginPosPreviewRequest(request: NextRequest) {
  const referer = request.headers.get("referer")?.trim();
  if (!referer) return false;

  try {
    const refererUrl = new URL(referer);
    return refererUrl.origin === request.nextUrl.origin && refererUrl.pathname.startsWith("/preview/pos");
  } catch {
    return false;
  }
}

function stripSupabaseSessionCookiesFromRequest(request: NextRequest) {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      request.cookies.delete(cookie.name);
    }
  }
}

async function refreshControlPlaneSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: SupabaseCookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  // Trigger lazy auth initialization / token rotation before Server Components
  // render. Errors are intentionally handled by the existing IT Admin guard.
  await supabase.auth.getUser();
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/it-admin")) {
    return refreshControlPlaneSession(request);
  }

  const { handoffName, sessionIdName } = resolvePosSessionCookieNames();
  const hasPosSession = Boolean(request.cookies.get(sessionIdName)?.value || request.cookies.get(handoffName)?.value);

  // Product/stock screens inside the POS still use two legacy Backoffice APIs.
  // When a Supabase Control Plane cookie is present in the same browser, the
  // legacy auth-context prefers that cookie and can lose the valid POS tenant /
  // branch scope. Remove Supabase cookies from the *forwarded request only* for
  // these exact APIs when the request is demonstrably coming from the POS UI.
  // Browser cookies are not cleared, so normal Backoffice / IT Admin auth stays
  // untouched. The API still validates the POS session through requirePosSession.
  if (POS_BACKOFFICE_AUTH_COMPAT_PATHS.has(pathname)) {
    if (hasPosSession && isSameOriginPosPreviewRequest(request)) {
      stripSupabaseSessionCookiesFromRequest(request);
      return NextResponse.next({ request });
    }
    return NextResponse.next();
  }

  if (hasPosSession) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login/store", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/preview/pos",
    "/it-admin/:path*",
    "/api/backoffice/catalog",
    "/api/backoffice/stock/settings"
  ]
};

import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function resolvePosSessionCookieNames() {
  const handoffName = String(process.env.POS_SESSION_COOKIE_NAME ?? "pos_session_handoff").trim() || "pos_session_handoff";
  const sessionIdName = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";

  return { handoffName, sessionIdName };
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
      setAll(cookiesToSet) {
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
  if (request.nextUrl.pathname.startsWith("/it-admin")) {
    return refreshControlPlaneSession(request);
  }

  const { handoffName, sessionIdName } = resolvePosSessionCookieNames();
  const hasPosSession = Boolean(request.cookies.get(sessionIdName)?.value || request.cookies.get(handoffName)?.value);

  if (hasPosSession) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login/store", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/preview/pos", "/it-admin/:path*"]
};

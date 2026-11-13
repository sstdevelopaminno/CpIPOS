import { NextResponse } from "next/server";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { deriveEmployeeCode, normalizePreferredLanguage, type PosPreferredLanguage } from "@/lib/server/pre-entry-auth";

type Body = {
  language?: string;
};

function setLanguageCookies(response: NextResponse, language: PosPreferredLanguage) {
  const secure = process.env.NODE_ENV === "production";
  for (const name of ["pos_lang", "sstipos_lang"]) {
    response.cookies.set({
      name,
      value: language,
      httpOnly: false,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });
  }
}

export async function GET() {
  try {
    const scope = await requirePosSession();
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("pos_user_profiles")
      .select("preferred_language")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("user_id", scope.session.user_id)
      .maybeSingle<{ preferred_language: string | null }>();

    if (error) {
      return NextResponse.json({ data: null, error: { code: "language_read_failed", message: error.message } }, { status: 500 });
    }

    const language = normalizePreferredLanguage(data?.preferred_language);
    const response = NextResponse.json({ data: { language }, error: null });
    setLanguageCookies(response, language);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) {
      return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ data: null, error: { code: "language_read_failed", message: "Unable to read language preference." } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    const body = (await request.json().catch(() => null)) as Body | null;
    const raw = String(body?.language ?? "").trim();
    if (raw !== "th" && raw !== "en" && raw !== "lo") {
      return NextResponse.json({ data: null, error: { code: "invalid_language", message: "language must be th, en, or lo." } }, { status: 422 });
    }

    const language = normalizePreferredLanguage(raw);
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("pos_user_profiles")
      .update({
        preferred_language: language,
        updated_at: new Date().toISOString()
      })
      .eq("tenant_id", scope.session.tenant_id)
      .eq("user_id", scope.session.user_id)
      .select("preferred_language")
      .maybeSingle<{ preferred_language: string }>();

    if (error) {
      return NextResponse.json({ data: null, error: { code: "language_save_failed", message: error.message } }, { status: 500 });
    }
    // Older POS users can sign in with a derived employee code even when no
    // pos_user_profiles row exists. Persist their preference on first save.
    if (!data) {
      const created = await supabase
        .from("pos_user_profiles")
        .insert({
          tenant_id: scope.session.tenant_id,
          user_id: scope.session.user_id,
          employee_code: deriveEmployeeCode(scope.session.user_id),
          preferred_language: language
        })
        .select("preferred_language")
        .single<{ preferred_language: string }>();
      if (created.error) {
        if (created.error.code !== "23505") {
          return NextResponse.json({ data: null, error: { code: "language_save_failed", message: created.error.message } }, { status: 500 });
        }
        // A concurrent first save may have inserted this user's profile.
        const retried = await supabase
          .from("pos_user_profiles")
          .update({ preferred_language: language })
          .eq("tenant_id", scope.session.tenant_id)
          .eq("user_id", scope.session.user_id)
          .select("preferred_language")
          .maybeSingle<{ preferred_language: string }>();
        if (retried.error || !retried.data) {
          return NextResponse.json({ data: null, error: { code: "language_save_failed", message: "Unable to save language preference." } }, { status: 500 });
        }
      }
    }

    const response = NextResponse.json({ data: { language }, error: null });
    setLanguageCookies(response, language);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) {
      return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ data: null, error: { code: "language_save_failed", message: "Unable to save language preference." } }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { validateControlPlaneEnvironment } from "@/lib/control-plane-env";
import { getServiceClient, IT_PRIMARY_SUPABASE_URL } from "@/lib/supabase";

export async function GET() {
  try {
    const { projectRef } = validateControlPlaneEnvironment();
    const service = getServiceClient();
    const { count, error } = await service
      .from("users_profiles")
      .select("id", { count: "exact", head: true })
      .in("platform_role", ["it_admin", "it_support"])
      .eq("is_active", true);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          project_ref: projectRef,
          service_role_present: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
          database_reachable: false,
          error_code: "database_query_failed"
        },
        { status: 503, headers: { "cache-control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        project_ref: projectRef,
        primary_url: IT_PRIMARY_SUPABASE_URL,
        service_role_present: true,
        database_reachable: true,
        active_it_accounts: count ?? 0
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json(
      {
        ok: false,
        project_ref: "deejlitaivfnsbwqdugy",
        service_role_present: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
        database_reachable: false,
        error_code: message.startsWith("Missing required environment variable:")
          ? "runtime_config_missing"
          : message.startsWith("SUPABASE_SERVICE_ROLE_KEY points to wrong project:")
            ? "wrong_service_role_project"
            : message === "SUPABASE_SERVICE_ROLE_KEY does not have service_role"
              ? "invalid_service_role_key"
              : "health_check_failed"
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}

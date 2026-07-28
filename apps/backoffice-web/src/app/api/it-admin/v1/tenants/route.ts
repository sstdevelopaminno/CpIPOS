import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { createTenant, listTenantSummaries, type TenantSummaryStatus } from "@/lib/services/it-admin/tenant-admin-service";

function parseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Internal server error.";
  const [code, detail] = message.includes(":") ? message.split(/:(.*)/s).map((part) => part.trim()) : ["it_admin_tenant_failed", message];
  if (code === "invalid_tenant_payload") return fail(code, detail || message, 422);
  if (code === "tenant_code_duplicate") return fail(code, detail || message, 409);
  return guardItAdminError(error);
}

export async function GET(req: Request) {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const { searchParams } = new URL(req.url);
    const result = await listTenantSummaries(context, {
      limit: Number(searchParams.get("limit") ?? 50),
      cursor: searchParams.get("cursor"),
      search: searchParams.get("search"),
      status: (searchParams.get("status") ?? "all") as TenantSummaryStatus,
      packageCode: searchParams.get("package_code")
    });

    const response = ok(result);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    response.headers.set("x-summary-source", result.source);
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const body = await req.json().catch(() => ({}));
    const created = await createTenant(context, body);
    const response = ok(created, 201);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}


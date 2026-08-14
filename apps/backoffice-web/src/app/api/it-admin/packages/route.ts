import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { getPackageCatalogWithFeatures } from "@/lib/services/subscription-package-service";

export async function GET() {
  try {
    await requireItAdmin();
    const catalog = await getPackageCatalogWithFeatures();
    const response=ok({generated_at:new Date().toISOString(),contract_types:["saas","perpetual"],billing_intervals:["monthly","yearly"],deployment_modes:["cloud","desktop_online","desktop_offline","hybrid"],packages:catalog.packages.filter(item=>item.isActive),features:catalog.features.filter(item=>item.isActive)});
    response.headers.set("cache-control","no-store"); return response;
  } catch (error) { const response=guardItAdminError(error); response.headers.set("cache-control","no-store"); return response; }
}

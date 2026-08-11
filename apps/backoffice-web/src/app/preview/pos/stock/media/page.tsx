import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import { ProductMediaManager, type ProductMediaManagerProduct } from "@/components/pos-preview/product-media-manager";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { getPrimarySupabaseServiceClient, getSupabaseServiceClient } from "@/lib/supabase-admin";

export default async function ProductMediaPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await requirePosPagePermission("inventory:view");
  const lang = await getCurrentLanguage();
  const th = lang === "th";
  const params = (await searchParams) ?? {};
  const rawBranchId = params.branch_id;
  const requestedBranchId = Array.isArray(rawBranchId) ? rawBranchId[0]?.trim() : typeof rawBranchId === "string" ? rawBranchId.trim() : "";
  const tenantId = scope.session.tenant_id;
  const userId = scope.session.user_id;
  const currentBranchId = scope.session.branch_id;
  const currentRole = String(scope.session.role ?? "staff");
  const primary = getPrimarySupabaseServiceClient();

  let branchId = requestedBranchId || currentBranchId;
  let branchRole = currentRole;
  if (branchId !== currentBranchId) {
    const { data: membership } = await primary
      .from("user_branch_roles")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("branch_id", branchId)
      .limit(1)
      .maybeSingle<{ role: string | null }>();
    if (!membership) {
      branchId = currentBranchId;
      branchRole = currentRole;
    } else {
      branchRole = String(membership.role ?? "staff");
    }
  }

  const [{ data: branch }, { data: productRows, error: productError }] = await Promise.all([
    primary
      .from("branches")
      .select("id,name,code")
      .eq("tenant_id", tenantId)
      .eq("id", branchId)
      .maybeSingle<{ id: string; name: string | null; code: string | null }>(),
    getSupabaseServiceClient()
      .from("products")
      .select("id,sku,name,category,is_active")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("name", { ascending: true })
  ]);

  if (productError) throw new Error("Failed to load products for media management.");

  const products: ProductMediaManagerProduct[] = (productRows ?? []).map((row) => ({
    id: String(row.id),
    sku: String(row.sku ?? ""),
    name: String(row.name ?? "-"),
    category: String(row.category ?? "")
  }));
  const branchName = String(branch?.name ?? branch?.code ?? branchId);
  const canManage = branchRole === "owner" || branchRole === "manager";

  return (
    <section className="pos-section-card w-full self-start overflow-hidden rounded-2xl border border-slate-300 bg-white">
      <header className="border-b border-slate-200 bg-[linear-gradient(130deg,#f8fbff_0%,#f2f7ff_45%,#f5f3ff_100%)] px-4 py-3 lg:px-6 lg:py-4">
        <PosBackButton lang={lang} href={`/preview/pos/stock?branch_id=${encodeURIComponent(branchId)}`} label={th ? "กลับจัดการสินค้า" : "Back to Product Management"} className="mb-3" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-xl font-extrabold text-slate-950 lg:text-2xl">{th ? "รูปสินค้า" : "Product Images"}</h1><p className="mt-1 text-sm font-semibold text-slate-600">{th ? `จัดการรูปสำหรับหน้าขายและ QR โต๊ะ · ${branchName}` : `Manage images for Sales and Table QR · ${branchName}`}</p></div>
          <span className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-violet-700">{th ? "Cloud Published + POS Cache" : "Cloud Published + POS Cache"}</span>
        </div>
      </header>
      <div className="px-4 py-4 lg:px-6">
        <ProductMediaManager th={th} branchId={branchId} branchName={branchName} products={products} canManage={canManage} />
      </div>
    </section>
  );
}

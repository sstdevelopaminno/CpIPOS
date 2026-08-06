import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { TakeawayCartShell, type ReceiptStoreProfile, type TakeawayCategory, type TakeawayProduct } from "@/components/sales/takeaway-cart-shell";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductRow = {
  id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  price: number | null;
  sell_unit: string | null;
  metadata?: {
    ingredients?: RawIngredientOption[];
    recipe?: RawIngredientOption[];
  } | null;
};

type RawIngredientOption = {
  id?: string | null;
  ingredient_id?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
  unit?: string | null;
  base_unit?: string | null;
  selected?: boolean | null;
  enabled?: boolean | null;
};

type CategoryRow = {
  id: string;
  name: string | null;
};

type DraftOrderRow = {
  id: string;
  order_no: string;
  metadata?: Record<string, unknown> | null;
};

type DraftItemRow = {
  product_id: string | null;
  quantity: number | null;
};

type SupabaseWriteError = {
  code?: string;
  message?: string;
};

type TenantStoreProfileRow = {
  name: string | null;
  display_name: string | null;
  logo_url: string | null;
  company_address: string | null;
  contact_phone: string | null;
  owner_phone: string | null;
};

type BranchRow = {
  name: string | null;
};

const ALL_CATEGORY = "\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14";
const OTHER_CATEGORY = "\u0e2d\u0e37\u0e48\u0e19\u0e46";
const LABEL_FALLBACK_STORE = "\u0e23\u0e49\u0e32\u0e19\u0e04\u0e49\u0e32";

function normalizeIngredientOptions(product: ProductRow) {
  const raw = product.metadata?.ingredients ?? product.metadata?.recipe ?? [];
  return raw
    .map((item, index) => {
      const name = String(item.name ?? "").trim();
      if (!name) return null;
      return {
        id: String(item.id ?? item.ingredient_id ?? `${product.id}-${index}`),
        name,
        quantity: Number(item.quantity ?? item.qty ?? 1),
        unit: String(item.unit ?? item.base_unit ?? ""),
        selected: item.selected ?? item.enabled ?? true,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function fallbackOrderNumber() {
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace(/\D/g, "");
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `TKO-${datePart}-${suffix}`;
}

async function nextOrderNumber(supabase: ReturnType<typeof createServiceClient>, tenantId: string, branchId: string) {
  const { data, error } = await supabase.rpc("next_pos_order_no", {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_prefix: "TKO",
  });
  if (error || typeof data !== "string" || !data.trim()) return fallbackOrderNumber();
  return data;
}

function isLegacyLongOrderNo(value: string | undefined) {
  return Boolean(value && /^TKO-\d{14,}-[A-Z0-9]{4,}$/i.test(value));
}

function isDuplicateOrderNoError(error: unknown) {
  const writeError = error as SupabaseWriteError | null;
  return writeError?.code === "23505" && String(writeError.message ?? "").includes("orders_tenant_id_branch_id_order_no_key");
}

async function findActiveDraft(
  supabase: ReturnType<typeof createServiceClient>,
  scope: Awaited<ReturnType<typeof requireOpenShift>>["scope"],
  shiftId: string,
) {
  const { data, error } = await supabase
    .from("orders")
    .select("id,order_no,metadata")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("shift_id", shiftId)
    .eq("pos_session_id", scope.sessionId)
    .eq("device_code", scope.deviceCode)
    .eq("order_type", "takeaway")
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);
  return ((data ?? []) as DraftOrderRow[]).find((order) => order.metadata?.hold_state !== "held") ?? null;
}

async function createDraftOrder(
  supabase: ReturnType<typeof createServiceClient>,
  scope: Awaited<ReturnType<typeof requireOpenShift>>["scope"],
  shiftId: string,
) {
  let lastError: SupabaseWriteError | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: createdDraft, error: draftCreateError } = await supabase
      .from("orders")
      .insert({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        shift_id: shiftId,
        order_no: await nextOrderNumber(supabase, scope.tenantId, scope.branchId),
        order_type: "takeaway",
        channel: "takeaway",
        subtotal: 0,
        discount_amount: 0,
        total_amount: 0,
        grand_total: 0,
        tax_total: 0,
        paid_total: 0,
        status: "draft",
        created_by: scope.userId,
        cashier_user_id: scope.userId,
        pos_session_id: scope.sessionId,
        device_code: scope.deviceCode,
        request_id: crypto.randomUUID(),
        metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web", mode: "takeaway", opened_from: "sales_mode" },
      })
      .select("id,order_no")
      .single<DraftOrderRow>();

    if (!draftCreateError && createdDraft) {
      await appendMobileAuditLog({
        scope,
        action: "mobile_takeaway_bill_opened",
        targetTable: "orders",
        targetId: createdDraft.id,
        metadata: { order_no: createdDraft.order_no, shift_id: shiftId, opened_from: "sales_mode" },
        afterData: { status: "draft", order_type: "takeaway", shift_id: shiftId },
      });
      return createdDraft;
    }
    if (!isDuplicateOrderNoError(draftCreateError)) {
      throw new Error(draftCreateError?.message ?? "draft_order_create_failed");
    }

    lastError = draftCreateError;
    const activeDraft = await findActiveDraft(supabase, scope, shiftId);
    if (activeDraft) return activeDraft;
  }

  throw new Error(lastError?.message ?? "draft_order_create_failed");
}

async function shortenEmptyLegacyDraftOrderNo(
  supabase: ReturnType<typeof createServiceClient>,
  scope: Awaited<ReturnType<typeof requireOpenShift>>["scope"],
  orderId: string,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shortOrderNo = await nextOrderNumber(supabase, scope.tenantId, scope.branchId);
    const { error } = await supabase
      .from("orders")
      .update({ order_no: shortOrderNo, updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("status", "draft");

    if (!error) return shortOrderNo;
    if (!isDuplicateOrderNoError(error)) return null;
  }

  return null;
}

export default async function TakeawaySalesPage() {
  const { scope, shift } = await requireOpenShift(["owner", "manager", "staff"]);
  const supabase = createServiceClient();

  const [{ data: categoryRows }, { data: productRows }, { data: existingDraft, error: draftLookupError }, { data: tenantProfile }, { data: branchProfile }] = await Promise.all([
    supabase
      .from("product_categories")
      .select("id,name")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .order("name", { ascending: true }),
    supabase
      .from("products")
      .select("id,sku,name,category,price,sell_unit,metadata")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("orders")
      .select("id,order_no,metadata")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("shift_id", shift.id)
      .eq("pos_session_id", scope.sessionId)
      .eq("device_code", scope.deviceCode)
      .eq("order_type", "takeaway")
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase
      .from("tenants")
      .select("name,display_name,logo_url,company_address,contact_phone,owner_phone")
      .eq("id", scope.tenantId)
      .maybeSingle<TenantStoreProfileRow>(),
    supabase
      .from("branches")
      .select("name")
      .eq("id", scope.branchId)
      .eq("tenant_id", scope.tenantId)
      .maybeSingle<BranchRow>(),
  ]);
  if (draftLookupError) throw new Error(draftLookupError.message);

  const activeDraft = ((existingDraft ?? []) as DraftOrderRow[]).find((order) => order.metadata?.hold_state !== "held");
  let orderId = activeDraft?.id;
  let orderNo = activeDraft?.order_no;
  if (!orderId || !orderNo) {
    const createdDraft = await createDraftOrder(supabase, scope, shift.id);
    orderId = createdDraft.id;
    orderNo = createdDraft.order_no;
  }

  const { data: draftItems } = await supabase
    .from("order_items")
    .select("product_id,quantity")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("order_id", orderId);

  if (orderId && isLegacyLongOrderNo(orderNo) && !((draftItems ?? []) as DraftItemRow[]).length) {
    const shortOrderNo = await shortenEmptyLegacyDraftOrderNo(supabase, scope, orderId);
    if (shortOrderNo) orderNo = shortOrderNo;
  }

  const products: TakeawayProduct[] = ((productRows ?? []) as ProductRow[])
    .filter((product) => product.id && product.name)
    .map((product) => ({
      id: product.id,
      sku: product.sku,
      name: String(product.name),
      category: String(product.category || OTHER_CATEGORY),
      price: Number(product.price ?? 0),
      sellUnit: product.sell_unit,
      ingredients: normalizeIngredientOptions(product),
    }));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const initialCart = ((draftItems ?? []) as DraftItemRow[])
    .map((item) => {
      if (!item.product_id) return null;
      const product = productsById.get(item.product_id);
      if (!product) return null;
      const quantity = Number(item.quantity ?? 0);
      if (quantity <= 0) return null;
      return { ...product, quantity };
    })
    .filter((item): item is TakeawayProduct & { quantity: number } => Boolean(item));

  const categoryNames = new Set<string>();
  for (const category of (categoryRows ?? []) as CategoryRow[]) {
    if (category.name) categoryNames.add(category.name);
  }
  for (const product of products) categoryNames.add(product.category);

  const categories: TakeawayCategory[] = [
    { id: "all", name: ALL_CATEGORY },
    ...Array.from(categoryNames).sort((a, b) => a.localeCompare(b, "th")).map((name) => ({ id: name, name })),
  ];
  const receiptStoreProfile: ReceiptStoreProfile = {
    displayName: String(tenantProfile?.display_name || tenantProfile?.name || LABEL_FALLBACK_STORE),
    logoUrl: String(tenantProfile?.logo_url || "/brand/cpipos-logo.png"),
    companyAddress: String(tenantProfile?.company_address || ""),
    contactPhone: String(tenantProfile?.contact_phone || tenantProfile?.owner_phone || ""),
    branchName: String(branchProfile?.name || scope.branchId),
  };

  return (
    <MobileAppShell scope={scope}>
      <TakeawayCartShell categories={categories} products={products} orderId={orderId} orderNo={orderNo} receiptStoreProfile={receiptStoreProfile} initialCart={initialCart} />
    </MobileAppShell>
  );
}

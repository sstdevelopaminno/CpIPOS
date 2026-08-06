import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { TakeawayCartShell, type ReceiptStoreProfile, type TakeawayCategory, type TakeawayProduct } from "@/components/sales/takeaway-cart-shell";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ tableId: string }>;
};

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

type DiningTableRow = {
  id: string;
  table_code: string | null;
  table_name: string | null;
  capacity: number | null;
  status: string | null;
  is_active: boolean | null;
};

type TableSessionRow = {
  id: string;
  order_id: string | null;
  status: string | null;
  opened_at: string | null;
  metadata: Record<string, unknown> | null;
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

const ALL_CATEGORY = "ทั้งหมด";
const OTHER_CATEGORY = "อื่นๆ";
const LABEL_FALLBACK_STORE = "ร้านค้า";

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
  return `DIN-${datePart}-${suffix}`;
}

async function nextOrderNumber(supabase: ReturnType<typeof createServiceClient>, tenantId: string, branchId: string) {
  const { data, error } = await supabase.rpc("next_pos_order_no", {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_prefix: "DIN",
  });
  if (error || typeof data !== "string" || !data.trim()) return fallbackOrderNumber();
  return data;
}

function isDuplicateOrderNoError(error: unknown) {
  const writeError = error as SupabaseWriteError | null;
  return writeError?.code === "23505" && String(writeError.message ?? "").includes("orders_tenant_id_branch_id_order_no_key");
}

async function openOrLoadTableSession(
  supabase: ReturnType<typeof createServiceClient>,
  scope: Awaited<ReturnType<typeof requireOpenShift>>["scope"],
  table: DiningTableRow,
  shiftId: string,
) {
  const { data: existingSession, error: existingSessionError } = await supabase
    .from("table_bill_sessions")
    .select("id,order_id,status,opened_at,metadata")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("table_id", table.id)
    .in("status", ["open", "ordering", "pending_payment"])
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<TableSessionRow>();
  if (existingSessionError) throw new Error(existingSessionError.message);
  if (existingSession) return existingSession;

  const nowIso = new Date().toISOString();
  const { data: created, error: createError } = await supabase
    .from("table_bill_sessions")
    .insert({
      tenant_id: scope.tenantId,
      branch_id: scope.branchId,
      table_id: table.id,
      opened_by: scope.userId,
      status: "open",
      metadata: { source_app: "CpIPOS Mobile",
          source_channel: "mobile_web", mode: "dine_in", opened_shift_id: shiftId },
    })
    .select("id,order_id,status,opened_at,metadata")
    .single<TableSessionRow>();

  if (createError) {
    const { data: racedSession, error: racedError } = await supabase
      .from("table_bill_sessions")
      .select("id,order_id,status,opened_at,metadata")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("table_id", table.id)
      .in("status", ["open", "ordering", "pending_payment"])
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle<TableSessionRow>();
    if (racedError) throw new Error(racedError.message);
    if (racedSession) return racedSession;
    throw new Error(createError.message);
  }

  await supabase
    .from("dining_tables")
    .update({ status: "occupied", updated_at: nowIso })
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("id", table.id);

  return created;
}

async function createDineInDraftOrder(
  supabase: ReturnType<typeof createServiceClient>,
  scope: Awaited<ReturnType<typeof requireOpenShift>>["scope"],
  shiftId: string,
  table: DiningTableRow,
  session: TableSessionRow,
) {
  let lastError: SupabaseWriteError | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        shift_id: shiftId,
        order_no: await nextOrderNumber(supabase, scope.tenantId, scope.branchId),
        order_type: "dine_in",
        channel: "dine_in",
        table_id: table.id,
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
        metadata: {
          source_app: "CpIPOS Mobile",
          source_channel: "mobile_web",
          mode: "dine_in",
          table_session_id: session.id,
          table_name: table.table_name ?? table.table_code,
        },
      })
      .select("id,order_no,metadata")
      .single<DraftOrderRow>();

    if (!error && data) return data;
    if (!isDuplicateOrderNoError(error)) throw new Error(error?.message ?? "dine_in_draft_create_failed");
    lastError = error;
  }

  throw new Error(lastError?.message ?? "dine_in_draft_create_failed");
}

async function findDraftOrderForTableSession(
  supabase: ReturnType<typeof createServiceClient>,
  scope: Awaited<ReturnType<typeof requireOpenShift>>["scope"],
  tableId: string,
  session: TableSessionRow,
) {
  const { data, error } = await supabase
    .from("orders")
    .select("id,order_no,metadata")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("table_id", tableId)
    .eq("order_type", "dine_in")
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  return ((data ?? []) as DraftOrderRow[]).find((order) => order.id === session.order_id || order.metadata?.table_session_id === session.id) ?? null;
}

async function deleteUnclaimedEmptyDraftOrder(
  supabase: ReturnType<typeof createServiceClient>,
  scope: Awaited<ReturnType<typeof requireOpenShift>>["scope"],
  orderId: string,
) {
  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", orderId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("status", "draft");
  if (error) console.error("[mobile.dine-in] unclaimed draft cleanup failed", error.message);
}

export default async function DineInTablePage({ params }: PageProps) {
  const { tableId } = await params;
  const { scope, shift } = await requireOpenShift(["owner", "manager", "staff"]);
  const supabase = createServiceClient();

  const { data: table, error: tableError } = await supabase
    .from("dining_tables")
    .select("id,table_code,table_name,capacity,status,is_active")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("id", tableId)
    .maybeSingle<DiningTableRow>();
  if (tableError) throw new Error(tableError.message);
  if (!table) notFound();

  const tableName = table.table_name || table.table_code || "โต๊ะ";
  if (!table.is_active || table.status === "disabled" || table.status === "reserved") {
    return (
      <MobileAppShell scope={scope}>
        <section className="grid gap-3">
          <div className="rounded-[18px] border border-[#d4e5f8] bg-white p-5 shadow-[0_8px_20px_rgba(15,39,69,0.06)]">
            <h1 className="m-0 text-[22px] font-black text-[#0f2745]">โต๊ะ {tableName}</h1>
            <p className="m-0 mt-2 text-[14px] font-bold text-[#d62929]">โต๊ะนี้ยังไม่พร้อมเปิดบิล</p>
          </div>
          <Link href="/sales/table" className="inline-flex min-h-11 items-center justify-center rounded-[14px] border border-[#d4e5f8] bg-white px-4 text-[13px] font-black text-[#17416f] no-underline">กลับไปเลือกโต๊ะ</Link>
        </section>
      </MobileAppShell>
    );
  }

  const [{ data: categoryRows }, { data: productRows }, { data: tenantProfile }, { data: branchProfile }] = await Promise.all([
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

  const session = await openOrLoadTableSession(supabase, scope, table, shift.id);
  let activeOrder: DraftOrderRow | null = null;
  if (session.order_id) {
    const { data: existingOrder, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,metadata")
      .eq("id", session.order_id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("table_id", table.id)
      .eq("order_type", "dine_in")
      .eq("status", "draft")
      .maybeSingle<DraftOrderRow>();
    if (orderError) throw new Error(orderError.message);
    activeOrder = existingOrder;
  }

  if (!activeOrder) {
    activeOrder = await findDraftOrderForTableSession(supabase, scope, table.id, session);
  }

  if (!activeOrder) {
    const createdOrder = await createDineInDraftOrder(supabase, scope, shift.id, table, session);
    const { data: claimedSession, error: claimError } = await supabase
      .from("table_bill_sessions")
      .update({
        order_id: createdOrder.id,
        metadata: {
          ...(session.metadata ?? {}),
          opened_shift_id: shift.id,
          last_order_id: createdOrder.id,
          last_order_no: createdOrder.order_no,
          source_app: "CpIPOS Mobile",
          source_channel: "mobile_web",
          mode: "dine_in",
        },
      })
      .eq("id", session.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .in("status", ["open", "ordering", "pending_payment"])
      .is("order_id", null)
      .select("id,order_id,status,opened_at,metadata")
      .maybeSingle<TableSessionRow>();

    if (claimError) throw new Error(claimError.message);

    if (claimedSession?.order_id === createdOrder.id) {
      activeOrder = createdOrder;
      await appendMobileAuditLog({
        scope,
        action: "mobile_dine_in_table_opened",
        targetTable: "orders",
        targetId: createdOrder.id,
        metadata: {
          order_no: createdOrder.order_no,
          table_id: table.id,
          table_name: table.table_name ?? table.table_code ?? null,
          table_session_id: session.id,
          shift_id: shift.id,
        },
        afterData: { status: "draft", order_type: "dine_in", table_id: table.id, shift_id: shift.id },
      });
    } else {
      const { data: latestSession, error: latestSessionError } = await supabase
        .from("table_bill_sessions")
        .select("id,order_id,status,opened_at,metadata")
        .eq("id", session.id)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .maybeSingle<TableSessionRow>();
      if (latestSessionError) throw new Error(latestSessionError.message);

      const racedOrder = latestSession ? await findDraftOrderForTableSession(supabase, scope, table.id, latestSession) : null;
      await deleteUnclaimedEmptyDraftOrder(supabase, scope, createdOrder.id);
      if (!racedOrder) throw new Error("table_session_claim_failed");
      activeOrder = racedOrder;
    }
  }

  const { data: draftItems } = await supabase
    .from("order_items")
    .select("product_id,quantity")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("order_id", activeOrder.id);

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
      <TakeawayCartShell
        categories={categories}
        products={products}
        orderId={activeOrder.id}
        orderNo={activeOrder.order_no}
        receiptStoreProfile={receiptStoreProfile}
        initialCart={initialCart}
        mode={{
          saleLabel: `โต๊ะ ${tableName}`,
          backHref: "/sales/table",
          returnHref: "/sales/table",
          checkoutEndpoint: "/api/mobile/sales/dine-in/checkout",
          holdEndpoint: "/api/mobile/sales/dine-in/hold",
          cancelEndpoint: "/api/mobile/sales/dine-in/cancel",
          cancelSuccessMessage: "ยกเลิกบิลโต๊ะสำเร็จ กำลังกลับไปเลือกโต๊ะ...",
        }}
      />
    </MobileAppShell>
  );
}



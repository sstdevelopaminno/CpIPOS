import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { AddProductPopupButton } from "@/components/pos-preview/add-product-popup-button";
import type { BranchRole } from "@pos/shared-types";
import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import { StockBranchSelector } from "@/components/pos-preview/stock-branch-selector";
import { StockProductsTable } from "@/components/pos-preview/stock-products-table";
import { cookies } from "next/headers";
import { DEFAULT_DELIVERY_CHANNEL_CONFIGS } from "@/lib/delivery-pricing";
import { getCurrentLanguage, t } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { mergeCategoryCountItems } from "@/lib/pos/category-normalization";
import { getProductSpecialPrice, isProductRecommended } from "@/lib/pos/product-metadata";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { RwWarehouseWorkspace } from "@/components/pos-preview/rw-warehouse-workspace";
import { rwWarehouseUatAllowed } from "@/lib/retail-wholesale/warehouse-uat-policy";
import { collectPagedShiftRows, collectShiftRowsForIds } from "@/lib/pos-shift-query-pagination";
import { loadProductMediaMap } from "@/lib/product-media";
import { estimateRetailStockCost, explicitRetailPrice } from "@/lib/retail-wholesale/stock-display";
import { getCustomPosStockUiMode } from "@/lib/server/custom-stock-ui-policy";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";

const ARCHIVED_INGREDIENT_PREFIX = "__archived__:";
const FALLBACK_INGREDIENT_PREFIX = "STOCK:";
const POS_ALLOW_NEGATIVE_STOCK_COOKIE = "pos_allow_negative_stock";

type ProductRow = {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  price: number;
  is_active: boolean;
  updated_at: string;
  stock_deduction_mode?: "unit_only" | "recipe_deduction" | null;
  metadata?: Record<string, unknown> | null;
  is_recommended?: boolean;
  special_price?: number | null;
  delivery_price_preview?: number;
  stock_on_hand_units?: number | null;
  stock_on_hand_note?: string;
  has_ingredient_recipe?: boolean;
  rw_cost?: number | null;
  rw_online_price?: number | null;
  rw_wholesale_price?: number | null;
  rw_thumbnail?: string | null;
};

type DeliveryPriceRow = {
  product_id: string;
  channel: string;
  app_price: number;
};

type DeliveryRateForForm = {
  channel: "line_man" | "grab" | "shopee";
  channelLabel: string;
  commissionRatePct: number;
  commissionVatRatePct: number;
};

type RecipeStockRow = {
  product_id: string;
  quantity_per_item: number;
  ingredients:
    | {
        id?: string | null;
        name?: string | null;
        base_unit?: string | null;
        quantity_on_hand: number | null;
        avg_unit_cost?: number | null;
      }
    | Array<{
        id?: string | null;
        name?: string | null;
        base_unit?: string | null;
        quantity_on_hand: number | null;
        avg_unit_cost?: number | null;
      }>
    | null;
};

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
};

type BranchOption = {
  id: string;
  name: string;
  code: string | null;
};

function getPreferredDeliveryPrice(priceMap: Map<string, Map<string, number>>, productId: string, fallback: number) {
  const channels = ["line_man", "grab", "shopee"];
  const prices = priceMap.get(productId);
  if (!prices) return fallback;
  for (const channel of channels) {
    const next = prices.get(channel);
    if (Number.isFinite(next)) return Number(next);
  }
  return fallback;
}

function isMissingTableError(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST205" || String(error.message ?? "").toLowerCase().includes("could not find the table");
}

function isMissingColumnError(error: PostgrestErrorLike | null | undefined, column: string): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = String(error.message ?? "").toLowerCase();
  return code === "42703" || text.includes(`column "${column}"`) || text.includes(`.${column}`) || text.includes("does not exist");
}

function readBoolCookie(value: string | undefined): boolean | null {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function envFallbackAllowNegativeStock() {
  return process.env.POS_ALLOW_NEGATIVE_STOCK === "1" || process.env.POS_ALLOW_NEGATIVE_STOCK?.toLowerCase() === "true";
}

export default async function PosStockPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/stock");
  const scope = await requirePosPagePermission("inventory:view");
  // Isolated Recycling catalogue; never replace the ordinary/Optical stock page.
  if (await isAuthorizedRecyclingTenant(scope.session.tenant_id)) redirect("/preview/pos/recycling/stock");
  // Optical-only/retail-only CUSTOM gets its own read-only catalogue instead
  // of restaurant ingredient popups; food, fixed plans and ambiguous grants
  // retain their existing stock workflow unchanged.
  const customStockMode = await getCustomPosStockUiMode(scope.session.tenant_id);
  if(customStockMode==="optical"||customStockMode==="retail") {
    redirect("/preview/pos/stock/custom");
  }
  const retailWholesale = customStockMode === "retail_wholesale";
  const lang = await getCurrentLanguage();
  const th = lang === "th";

  let totalProducts = 0;
  let lowStockCount = 0;
  let productsForTable: ProductRow[] = [];
  let deliveryRatesForAddProduct: DeliveryRateForForm[] = [];
  let categoryList: Array<{ name: string; productCount: number }> = [];
  let ingredientList: Array<{ id: string; name: string; baseUnit: string; quantityOnHand: number; reorderLevel: number }> = [];
  let unitStockList: Array<{ productId: string; sku: string; name: string; category: string; stockOnHand: number }> = [];
  let allowNegativeStock = false;
  let inventorySettingsReady = true;
  let inventorySettingsMessage = "";
  let canManageCatalog = false;
  let branchOptions: BranchOption[] = [];
  let selectedBranchId = "";
  let selectedBranchName = "";
  let branchScopeWarning = "";
  let rwDataWarning = "";
  let warehouseView = false;
  let canSelectBranch = false;

  try {
    const resolvedSearchParams = (await searchParams) ?? {};
    warehouseView = retailWholesale && resolvedSearchParams.stock_scope === "warehouse";
    const cookieStore = await cookies();
    const cookieFallback = readBoolCookie(cookieStore.get(POS_ALLOW_NEGATIVE_STOCK_COOKIE)?.value);
    const fallbackAllowNegativeStock = cookieFallback ?? envFallbackAllowNegativeStock();
    const auth = {
      userId: scope.session.user_id,
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      branchRole: scope.session.role as BranchRole
    };
    const supabase = getSupabaseServiceClient();
    canManageCatalog = auth.branchRole === "owner" || auth.branchRole === "manager";
    canSelectBranch = canManageCatalog;

    const rawRequestedBranchId = resolvedSearchParams.branch_id;
    const requestedBranchId = Array.isArray(rawRequestedBranchId)
      ? rawRequestedBranchId[0]?.trim() || null
      : typeof rawRequestedBranchId === "string"
        ? rawRequestedBranchId.trim()
        : null;

    const [{ data: branchRows, error: branchError }, { data: membershipRows, error: membershipError }] = await Promise.all([
      supabase
        .from("branches")
        .select("id,name,code,is_active")
        .eq("tenant_id", auth.tenantId!)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("user_branch_roles")
        .select("branch_id,role")
        .eq("tenant_id", auth.tenantId!)
        .eq("user_id", auth.userId)
    ]);

    if (branchError || membershipError) {
      throw new Error("Failed to load branch options.");
    }

    const allowedBranchIds = new Set(
      (membershipRows ?? [])
        .map((row) => String((row as { branch_id?: string | null }).branch_id ?? ""))
        .filter((value) => value.length > 0)
    );

    const allBranches = ((branchRows ?? []) as Array<{ id: string; name: string | null; code: string | null }>)
      .map((row) => ({
        id: String(row.id),
        name: String(row.name ?? row.code ?? row.id),
        code: row.code ? String(row.code) : null
      }))
      .filter((row) => allowedBranchIds.has(row.id));

    branchOptions = allBranches.length > 0 ? allBranches : [{ id: auth.branchId!, name: auth.branchId!, code: null }];
    const fallbackBranchId = branchOptions.some((item) => item.id === auth.branchId!) ? auth.branchId! : branchOptions[0].id;
    selectedBranchId =
      canManageCatalog && requestedBranchId && branchOptions.some((item) => item.id === requestedBranchId)
        ? requestedBranchId
        : fallbackBranchId;
    selectedBranchName = branchOptions.find((item) => item.id === selectedBranchId)?.name ?? selectedBranchId;
    if (retailWholesale && selectedBranchId !== auth.branchId) {
      canManageCatalog = canManageCatalog && (membershipRows ?? []).some(row => row.branch_id === selectedBranchId && (row.role === "owner" || row.role === "manager"));
    }

    if (requestedBranchId && requestedBranchId !== selectedBranchId) {
      branchScopeWarning = th
        ? "ไม่สามารถเลือกสาขานี้ได้ เนื่องจากสิทธิ์ไม่ครอบคลุม"
        : "Requested branch is not available for your role.";
    }

    // The inactive warehouse workspace has no branch stock query or branch totals.
    if (warehouseView) return (
      <section className="rw-stock-layout flex h-full min-h-0 w-full flex-col overflow-y-auto bg-white">
        <header className="border-b border-slate-200 bg-slate-50 p-4">
          <PosBackButton lang={lang} href="/preview/pos/more" label={th?"กลับเมนูเพิ่มเติม":"Back to More"} className="mb-3"/>
          <h2 className="text-xl font-extrabold text-slate-900">{th?"จัดการสินค้าและสต๊อก · ค้าปลีก–ค้าส่ง":"Retail & Wholesale Inventory"}</h2>
          <nav aria-label={th?"ประเภทสต๊อก":"Inventory scope"} className="mt-3 flex flex-wrap gap-2">
            <Link href={`/preview/pos/stock?branch_id=${encodeURIComponent(selectedBranchId)}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">{th?"สต๊อกร้าน / สาขา":"Branch stock"}</Link>
            <span aria-current="page" className="rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-bold text-white">{th?"สต๊อกคลังสินค้า":"Warehouse stock"}</span>
          </nav>
        </header>
        {rwWarehouseUatAllowed(scope.session.tenant_id, {
          VERCEL_ENV: process.env.VERCEL_ENV,
          RW_WAREHOUSE_UAT_ENABLED: process.env.RW_WAREHOUSE_UAT_ENABLED,
          RW_WAREHOUSE_UAT_TENANT_ID: process.env.RW_WAREHOUSE_UAT_TENANT_ID
        }) ? <RwWarehouseWorkspace th={th}/> : <section className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-5" data-testid="rw-warehouse-not-active">
          <h3 className="font-extrabold text-slate-900">{th?"คลังสินค้ากลาง · ยังไม่เปิดรับ/โอนสินค้าจริง":"Central warehouse · transactions not enabled"}</h3>
          <p className="mt-2 text-sm text-slate-700">{th?"คลังกลางแยกจากยอดสาขา ระบบยังไม่เปิดให้รับสินค้า ออกใบโอน หรือยืนยันรับปลายทาง จึงไม่มีการแสดงยอดสมมติ":"Warehouse inventory is separate from branch stock. Receiving, transfer and destination receipt are not enabled; no estimated balances are displayed."}</p>
          <p className="mt-2 text-xs text-slate-600">{th?"ขั้นตอนที่เตรียมไว้: รับเข้าคลัง → จัดส่ง → สินค้าระหว่างทาง → สาขาตรวจรับ":"Planned flow: warehouse receipt → dispatch → in transit → branch receipt"}</p>
        </section>}
      </section>
    );

    const queryActiveProducts = () =>
      supabase
        .from("products")
        .select("id,sku,name,category,price,is_active,updated_at,stock_deduction_mode,metadata", { count: "exact" })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false });

    const productResponseWithStockMode = retailWholesale
      ? await collectPagedShiftRows<ProductRow>((from,to)=>queryActiveProducts().is("deleted_at",null).order("id",{ascending:true}).range(from,to))
      : await queryActiveProducts();

    let productsData = ((productResponseWithStockMode.data ?? []) as ProductRow[]).map((row) => ({
      ...row,
      is_recommended: isProductRecommended(row.metadata),
      special_price: getProductSpecialPrice(row.metadata),
      stock_deduction_mode: row.stock_deduction_mode ?? "unit_only"
    }));
    let productsCount = "count" in productResponseWithStockMode ? productResponseWithStockMode.count ?? 0 : productResponseWithStockMode.data?.length ?? 0;
    let productsError: PostgrestErrorLike | null = productResponseWithStockMode.error as PostgrestErrorLike | null;

    if (!retailWholesale && productsError && isMissingColumnError(productsError, "stock_deduction_mode")) {
      const legacyProducts = await supabase
        .from("products")
        .select("id,sku,name,category,price,is_active,updated_at", { count: "exact" })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false });

      productsData = (legacyProducts.data ?? []).map((row) => ({
        ...row,
        metadata: null,
        is_recommended: false,
        special_price: null,
        stock_deduction_mode: "unit_only" as const
      }));
      productsCount = legacyProducts.count ?? 0;
      productsError = legacyProducts.error as PostgrestErrorLike | null;
    }

    const [ingredientsResult, deliveryPricesResult, deliveryConfigsResult, inventorySettingsResult] = await Promise.all([
      supabase
        .from("ingredients")
        .select("id,name,base_unit,quantity_on_hand,reorder_level")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .not("name", "ilike", `${ARCHIVED_INGREDIENT_PREFIX}%`)
        .not("name", "ilike", `${FALLBACK_INGREDIENT_PREFIX}%`),
      supabase
        .from("product_channel_prices")
        .select("product_id,channel,app_price")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .eq("is_active", true),
      supabase
        .from("delivery_channel_configs")
        .select("channel,commission_rate_pct,commission_vat_rate_pct,source_checked_at")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .eq("is_active", true),
      supabase
        .from("branch_inventory_settings")
        .select("allow_negative_stock")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .maybeSingle<{ allow_negative_stock: boolean }>()
    ]);

    const categoriesRegistryResult = await supabase
      .from("product_categories")
      .select("name")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", selectedBranchId)
      .order("name", { ascending: true });

    if (productsError || ingredientsResult.error) {
      throw new Error("Failed to load stock preview data.");
    }

    totalProducts = productsCount;
    lowStockCount = ((ingredientsResult.data ?? []) as Array<{ quantity_on_hand: number; reorder_level: number }>).filter(
      (row) => Number(row.quantity_on_hand ?? 0) <= Number(row.reorder_level ?? 0)
    ).length;

    ingredientList = ((ingredientsResult.data ?? []) as Array<{ id: string; name: string; base_unit: string; quantity_on_hand: number; reorder_level: number }>)
      .map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        baseUnit: String(row.base_unit ?? "unit"),
        quantityOnHand: Number(row.quantity_on_hand ?? 0),
        reorderLevel: Number(row.reorder_level ?? 0)
      }))
      .filter((row) => row.name.length > 0)
      .filter((row) => !row.name.toUpperCase().startsWith(FALLBACK_INGREDIENT_PREFIX))
      .sort((a, b) => a.name.localeCompare(b.name, th ? "th" : "en"));

    if (inventorySettingsResult.error) {
      allowNegativeStock = fallbackAllowNegativeStock;
      inventorySettingsReady = true;
      inventorySettingsMessage = isMissingTableError(inventorySettingsResult.error as PostgrestErrorLike)
        ? t(lang, "pos_stock_inventory_fallback_table_unavailable")
        : t(lang, "pos_stock_inventory_fallback_read_failed");
    } else {
      allowNegativeStock = Boolean(inventorySettingsResult.data?.allow_negative_stock ?? false);
      inventorySettingsReady = true;
      inventorySettingsMessage = "";
    }

    const deliveryPriceMap = new Map<string, Map<string, number>>();
    const deliveryPriceRows =
      deliveryPricesResult.error && isMissingTableError(deliveryPricesResult.error as PostgrestErrorLike)
        ? []
        : ((deliveryPricesResult.data ?? []) as DeliveryPriceRow[]);
    for (const row of deliveryPriceRows) {
      const productId = String(row.product_id);
      if (!deliveryPriceMap.has(productId)) {
        deliveryPriceMap.set(productId, new Map<string, number>());
      }
      deliveryPriceMap.get(productId)?.set(String(row.channel), Number(row.app_price));
    }

    const recipeStockByProduct = new Map<string, number | null>();
    const hasIngredientRecipeByProduct = new Map<string, boolean>();
    let recipeRowsForStock: RecipeStockRow[] = [];
    const productIds = productsData.map((row) => String(row.id));
    if (productIds.length > 0) {
      const recipeQuery = (ids: string[]) => supabase
        .from("recipes")
        .select(retailWholesale ? "product_id,quantity_per_item,ingredients(id,name,base_unit,quantity_on_hand,avg_unit_cost)" : "product_id,quantity_per_item,ingredients(id,name,base_unit,quantity_on_hand)")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .in("product_id", ids);
      const { data: recipeRows, error: recipeError } = retailWholesale
        ? await collectShiftRowsForIds<RecipeStockRow>(productIds,(batch,from,to)=>recipeQuery(batch).order("product_id",{ascending:true}).order("id",{ascending:true}).range(from,to))
        : await recipeQuery(productIds);
      if(retailWholesale && recipeError) throw new Error("RW stock lookup failed.");

      if (!recipeError) {
        recipeRowsForStock = (recipeRows ?? []) as RecipeStockRow[];
        const ingredientCapsByProduct = new Map<string, number[]>();
        for (const row of recipeRowsForStock) {
          const requiredQty = Number(row.quantity_per_item);
          const ingredientRecord = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
          const ingredientOnHand = Number(ingredientRecord?.quantity_on_hand ?? 0);
          const ingredientName = String(ingredientRecord?.name ?? "");
          const targetProduct = String(row.product_id);
          if (ingredientName && !ingredientName.startsWith(FALLBACK_INGREDIENT_PREFIX)) {
            hasIngredientRecipeByProduct.set(targetProduct, true);
          }
          if (!Number.isFinite(requiredQty) || requiredQty <= 0) continue;
          const availableItems = Math.max(0, Math.floor(ingredientOnHand / requiredQty));
          if (!ingredientCapsByProduct.has(targetProduct)) {
            ingredientCapsByProduct.set(targetProduct, []);
          }
          ingredientCapsByProduct.get(targetProduct)?.push(availableItems);
        }

        for (const productId of productIds) {
          const caps = ingredientCapsByProduct.get(productId);
          if (!caps || caps.length === 0) {
            recipeStockByProduct.set(productId, null);
            continue;
          }
          recipeStockByProduct.set(productId, Math.min(...caps));
        }
      }
    }

    const rwCostLines = new Map<string, Array<{ quantity: number; cost: unknown }>>();
    if (retailWholesale && canManageCatalog) {
      for (const row of recipeRowsForStock) {
        const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
        const entries = rwCostLines.get(row.product_id) ?? [];
        entries.push({quantity: Number(row.quantity_per_item), cost: ingredient?.avg_unit_cost});
        rwCostLines.set(row.product_id, entries);
      }
    }
    const rwMedia = new Map<string, string>();
    if (retailWholesale) {
      try {
        for(let i=0;i<productIds.length;i+=200) {
          const assets=await loadProductMediaMap({tenantId:auth.tenantId!,branchId:selectedBranchId,productIds:productIds.slice(i,i+200)});
          for(const [id,asset] of assets) rwMedia.set(id,asset.thumbnail_url);
        }
      } catch {
        rwDataWarning = th ? "โหลดรูปสินค้าบางรายการไม่สำเร็จ" : "Some product images could not be loaded.";
      }
    }
    productsForTable = productsData.map((row) => {
      const basePrice = Number(row.price);
      const stockUnits = recipeStockByProduct.has(row.id) ? (recipeStockByProduct.get(row.id) ?? null) : null;
      return {
        ...row,
        price: basePrice,
        ...(retailWholesale ? {
          rw_cost: canManageCatalog ? estimateRetailStockCost(rwCostLines.get(row.id) ?? []) : null,
          rw_online_price: explicitRetailPrice(row.metadata?.rw_online_price),
          rw_wholesale_price: explicitRetailPrice(row.metadata?.rw_wholesale_price),
          rw_thumbnail: rwMedia.get(row.id) ?? null
        } : {}),
        stock_deduction_mode: row.stock_deduction_mode ?? "unit_only",
        delivery_price_preview: getPreferredDeliveryPrice(deliveryPriceMap, row.id, basePrice),
        stock_on_hand_units: stockUnits,
        has_ingredient_recipe: hasIngredientRecipeByProduct.get(row.id) === true,
        stock_on_hand_note:
          stockUnits === null ? t(lang, "pos_stock_no_ingredient_recipe") : t(lang, "pos_stock_recipe_calculated")
      };
    });

    if (categoriesRegistryResult.error && !isMissingTableError(categoriesRegistryResult.error as PostgrestErrorLike)) {
      throw new Error("Failed to load category registry.");
    }
    categoryList = mergeCategoryCountItems(
      [
        ...productsForTable.map((item) => ({ name: item.category ?? "", productCount: 1 })),
        ...(categoriesRegistryResult.error ? [] : categoriesRegistryResult.data ?? []).map((row) => ({
          name: String((row as { name?: string | null }).name ?? ""),
          productCount: 0
        }))
      ],
      th ? "th" : "en"
    );

    const productById = new Map(productsForTable.map((item) => [String(item.id), item]));
    const unitStockMap = new Map<string, number>();
    for (const row of recipeRowsForStock) {
      const ingredientRecord = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
      const ingredientName = String(ingredientRecord?.name ?? "");
      if (!ingredientName.startsWith(FALLBACK_INGREDIENT_PREFIX)) continue;
      if (Number(row.quantity_per_item ?? 0) <= 0) continue;
      const stockOnHand = Number(ingredientRecord?.quantity_on_hand ?? 0) / Number(row.quantity_per_item ?? 1);
      unitStockMap.set(String(row.product_id), Math.max(0, Math.floor(stockOnHand)));
    }

    unitStockList = Array.from(unitStockMap.entries())
      .map(([productId, stockOnHand]) => {
        const product = productById.get(productId);
        if (!product) return null;
        return {
          productId,
          sku: String(product.sku ?? ""),
          name: String(product.name ?? "-"),
          category: String(product.category ?? t(lang, "pos_stock_uncategorized")),
          stockOnHand
        };
      })
      .filter((item): item is { productId: string; sku: string; name: string; category: string; stockOnHand: number } => Boolean(item));

    const deliveryConfigData =
      deliveryConfigsResult.error && isMissingTableError(deliveryConfigsResult.error as PostgrestErrorLike)
        ? []
        : ((deliveryConfigsResult.data ?? []) as Array<{
            channel: string;
            commission_rate_pct: number;
            commission_vat_rate_pct: number;
            source_checked_at: string | null;
          }>);

    const configRows =
      deliveryConfigData.length > 0
        ? deliveryConfigData
        : DEFAULT_DELIVERY_CHANNEL_CONFIGS.filter((entry) => ["line_man", "grab", "shopee"].includes(entry.channel)).map((entry) => ({
            channel: entry.channel,
            commission_rate_pct: entry.commissionRatePct,
            commission_vat_rate_pct: entry.commissionVatRatePct,
            source_checked_at: entry.sourceCheckedAt
          }));

    deliveryRatesForAddProduct = configRows
      .filter((row): row is { channel: "line_man" | "grab" | "shopee"; commission_rate_pct: number; commission_vat_rate_pct: number; source_checked_at: string | null } =>
        row.channel === "line_man" || row.channel === "grab" || row.channel === "shopee"
      )
      .map((row) => ({
        channel: row.channel,
        channelLabel: row.channel === "line_man" ? "LINE MAN" : row.channel === "grab" ? "GrabFood" : "ShopeeFood",
        commissionRatePct: Number(row.commission_rate_pct ?? 0),
        commissionVatRatePct: Number(row.commission_vat_rate_pct ?? 0)
      }));
  } catch {
    if(retailWholesale) {
      canManageCatalog = false;
      rwDataWarning = th ? "โหลดข้อมูลสินค้าไม่ครบ กรุณาตรวจสอบการเชื่อมต่อก่อนปรับสต๊อก" : "Product data is incomplete. Check the connection before adjusting stock.";
    }
    deliveryRatesForAddProduct = DEFAULT_DELIVERY_CHANNEL_CONFIGS.filter(
      (entry) => entry.channel === "line_man" || entry.channel === "grab" || entry.channel === "shopee"
    ).map((entry) => ({
      channel: entry.channel as "line_man" | "grab" | "shopee",
      channelLabel: entry.channel === "line_man" ? "LINE MAN" : entry.channel === "grab" ? "GrabFood" : "ShopeeFood",
      commissionRatePct: Number(entry.commissionRatePct ?? 0),
      commissionVatRatePct: Number(entry.commissionVatRatePct ?? 0)
    }));
  }

  return (
    <section className={retailWholesale ? "rw-stock-layout flex h-full min-h-0 w-full flex-col overflow-y-auto bg-white" : "pos-section-card w-full self-start overflow-hidden rounded-2xl border border-slate-300 bg-white"}>
      <div className="border-b border-slate-200 bg-[linear-gradient(130deg,#f8fbff_0%,#f2f7ff_34%,#fff7ed_100%)] px-4 py-3 lg:px-6 lg:py-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(360px,520px)_auto] lg:items-start">
          <div>
            <PosBackButton lang={lang} href="/preview/pos/more" label={lang === "th" ? "กลับเมนูเพิ่มเติม" : "Back to More"} className="mb-3" />
            <h2 className="mt-1 text-xl font-extrabold text-slate-900 lg:text-2xl">
              {retailWholesale ? (th ? "จัดการสินค้าและสต๊อก · ค้าปลีก–ค้าส่ง" : "Retail & Wholesale Inventory") : t(lang, "pos_stock_title")}
            </h2>
            {customStockMode==="mixed"?<Link href="/preview/pos/stock/custom"
              className="mt-2 inline-flex min-h-10 items-center rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-100">
              สต๊อกกรอบแว่น / เลนส์ (CUSTOM)
            </Link>:null}
          </div>

          <div className="lg:pt-1 [&>div]:mt-0">
            <StockBranchSelector
              th={th}
              canManageCatalog={retailWholesale?canSelectBranch:canManageCatalog}
              branchOptions={branchOptions}
              selectedBranchId={selectedBranchId}
            />
            {branchScopeWarning ? <p className="mt-1 text-xs font-semibold text-amber-700">{branchScopeWarning}</p> : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <details className="group relative">
              <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">
                <span className="group-open:hidden">{th ? "แสดงสรุป" : "Show Summary"}</span>
                <span className="hidden group-open:inline">{th ? "ซ่อนสรุป" : "Hide Summary"}</span>
              </summary>
              <div className="absolute right-0 top-full z-50 mt-2 grid w-80 grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-500">{t(lang, "pos_stock_total_products")}</p>
                  <p className="mt-0.5 text-2xl font-extrabold leading-none text-slate-900">{totalProducts}</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] text-amber-700">{t(lang, "pos_stock_low_ingredients")}</p>
                  <p className="mt-0.5 text-2xl font-extrabold leading-none text-amber-900">{lowStockCount}</p>
                </div>
              </div>
            </details>
            {!warehouseView ? <AddProductPopupButton
              th={th}
              categories={categoryList}
              ingredients={ingredientList}
              deliveryRates={deliveryRatesForAddProduct}
              branchId={selectedBranchId}
              disabled={!canManageCatalog}
              buttonLabel={th ? `เพิ่มสินค้า (${selectedBranchName})` : `Add Product (${selectedBranchName})`}
            /> : null}
          </div>
        </div>

        {retailWholesale ? <nav aria-label={th ? "ประเภทสต๊อก" : "Inventory scope"} className="mt-3 flex flex-wrap gap-2">
          <Link href={`/preview/pos/stock?branch_id=${encodeURIComponent(selectedBranchId)}`} aria-current={!warehouseView?"page":undefined} className={`rounded-lg border px-4 py-2 text-sm font-bold ${!warehouseView?"border-blue-600 bg-blue-600 text-white":"border-slate-300 bg-white text-slate-700"}`}>{th?"สต๊อกร้าน / สาขา":"Branch stock"}</Link>
          <Link href={`/preview/pos/stock?branch_id=${encodeURIComponent(selectedBranchId)}&stock_scope=warehouse`} aria-current={warehouseView?"page":undefined} className={`rounded-lg border px-4 py-2 text-sm font-bold ${warehouseView?"border-blue-600 bg-blue-600 text-white":"border-slate-300 bg-white text-slate-700"}`}>{th?"สต๊อกคลังสินค้า":"Warehouse stock"}</Link>
        </nav>:null}
        {!warehouseView ? <div
          id="stock-page-action-toolbar"
          className="mt-2 flex min-h-9 flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 pt-2"
          aria-label={th ? "เครื่องมือจัดการสินค้า" : "Product management tools"}
        /> : null}
      </div>

      {warehouseView ? <section className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-5" data-testid="rw-warehouse-not-active">
        <h3 className="font-extrabold text-slate-900">{th?"คลังสินค้ากลาง · ยังไม่เปิดรับ/โอนสินค้าจริง":"Central warehouse · transactions not enabled"}</h3>
        <p className="mt-2 text-sm text-slate-700">{th?"คลังกลางแยกจากยอดสาขา ระบบยังไม่เปิดให้รับสินค้า ออกใบโอน หรือยืนยันรับปลายทาง จึงไม่มีการแสดงยอดสมมติ":"Warehouse inventory is separate from branch stock. Receiving, transfer and destination receipt are not enabled; no estimated balances are displayed."}</p>
        <p className="mt-2 text-xs text-slate-600">{th?"ขั้นตอนที่เตรียมไว้: รับเข้าคลัง → จอง/จัดส่ง → สินค้าระหว่างทาง → สาขาตรวจรับ":"Planned flow: warehouse receipt → reserve/dispatch → in transit → branch receipt"}</p>
      </section> : <div className={retailWholesale?"min-w-0 flex-1 px-2 py-2":"grid gap-3 px-4 py-3 lg:px-6 lg:py-3"}>
        {rwDataWarning ? <p role="alert" className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{rwDataWarning}</p>:null}
        <div id="stock-products-table-area">
          <StockProductsTable
            th={th}
            products={productsForTable}
            categoryList={categoryList}
            ingredientList={ingredientList}
            deliveryRates={deliveryRatesForAddProduct}
            unitStockList={unitStockList}
            allowNegativeStock={allowNegativeStock}
            inventorySettingsReady={inventorySettingsReady}
            inventorySettingsMessage={inventorySettingsMessage}
            branchId={selectedBranchId}
            branchOptions={branchOptions}
            canManageCatalog={canManageCatalog}
            retailWholesale={retailWholesale}
          />
        </div>
      </div>}

      <style>{`
        #stock-products-table-area > div > div:last-of-type:not(.fixed) {
          border-color: #bfdbfe !important;
          background: #ffffff !important;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
        }
        #stock-products-table-area > div > div:last-of-type:not(.fixed) > span {
          color: #334155 !important;
          font-weight: 700 !important;
        }
        #stock-products-table-area > div > div:last-of-type:not(.fixed) > div:last-child > strong {
          min-width: 6rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          background: #f1f5f9;
          padding: 0.5rem 0.75rem;
          color: #334155;
          font-weight: 800;
        }
        #stock-products-table-area > div > div:last-of-type:not(.fixed) > div:last-child > button {
          min-height: 2.25rem;
          padding-left: 1rem;
          padding-right: 1rem;
          font-weight: 700;
        }
        #stock-products-table-area > div > div:last-of-type:not(.fixed) > div:last-child > button:last-child:not(:disabled) {
          border-color: #2563eb !important;
          background: #2563eb !important;
          color: #ffffff !important;
          box-shadow: 0 2px 6px rgba(37, 99, 235, 0.24);
        }
        #stock-products-table-area > div > div:last-of-type:not(.fixed) > div:last-child > button:last-child:not(:disabled):hover {
          background: #1d4ed8 !important;
        }
      `}</style>
    </section>
  );
}

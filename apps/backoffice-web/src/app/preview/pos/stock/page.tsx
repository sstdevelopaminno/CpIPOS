import { AddProductPopupButton } from "@/components/pos-preview/add-product-popup-button";
import type { BranchRole } from "@pos/shared-types";
import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import { StockBranchSelector } from "@/components/pos-preview/stock-branch-selector";
import { StockProductsTable } from "@/components/pos-preview/stock-products-table";
import { cookies } from "next/headers";
import { DEFAULT_DELIVERY_CHANNEL_CONFIGS } from "@/lib/delivery-pricing";
import { getCurrentLanguage, t } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

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
  delivery_price_preview?: number;
  stock_on_hand_units?: number | null;
  stock_on_hand_note?: string;
  has_ingredient_recipe?: boolean;
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
      }
    | Array<{
        id?: string | null;
        name?: string | null;
        base_unit?: string | null;
        quantity_on_hand: number | null;
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
  const scope = await requirePosPagePermission("inventory:view");
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

  try {
    const resolvedSearchParams = (await searchParams) ?? {};
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

    if (requestedBranchId && requestedBranchId !== selectedBranchId) {
      branchScopeWarning = th
        ? "ไม่สามารถเลือกสาขานี้ได้ เนื่องจากสิทธิ์ไม่ครอบคลุม"
        : "Requested branch is not available for your role.";
    }

    const queryActiveProducts = () =>
      supabase
        .from("products")
        .select("id,sku,name,category,price,is_active,updated_at,stock_deduction_mode", { count: "exact" })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false });

    const productResponseWithStockMode = await queryActiveProducts();

    let productsData = ((productResponseWithStockMode.data ?? []) as ProductRow[]).map((row) => ({
      ...row,
      stock_deduction_mode: row.stock_deduction_mode ?? "unit_only"
    }));
    let productsCount = productResponseWithStockMode.count ?? 0;
    let productsError: PostgrestErrorLike | null = productResponseWithStockMode.error as PostgrestErrorLike | null;

    if (productsError && isMissingColumnError(productsError, "stock_deduction_mode")) {
      const legacyProducts = await supabase
        .from("products")
        .select("id,sku,name,category,price,is_active,updated_at", { count: "exact" })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false });

      productsData = (legacyProducts.data ?? []).map((row) => ({ ...row, stock_deduction_mode: "unit_only" as const }));
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
      const { data: recipeRows, error: recipeError } = await supabase
        .from("recipes")
        .select("product_id,quantity_per_item,ingredients(id,name,base_unit,quantity_on_hand)")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", selectedBranchId)
        .in("product_id", productIds);

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

    productsForTable = productsData.map((row) => {
      const basePrice = Number(row.price);
      const stockUnits = recipeStockByProduct.has(row.id) ? (recipeStockByProduct.get(row.id) ?? null) : null;
      return {
        ...row,
        price: basePrice,
        stock_deduction_mode: row.stock_deduction_mode ?? "unit_only",
        delivery_price_preview: getPreferredDeliveryPrice(deliveryPriceMap, row.id, basePrice),
        stock_on_hand_units: stockUnits,
        has_ingredient_recipe: hasIngredientRecipeByProduct.get(row.id) === true,
        stock_on_hand_note:
          stockUnits === null ? t(lang, "pos_stock_no_ingredient_recipe") : t(lang, "pos_stock_recipe_calculated")
      };
    });

    const categoryMap = new Map<string, number>();
    for (const item of productsForTable) {
      const categoryName = (item.category ?? "").trim();
      if (!categoryName) continue;
      categoryMap.set(categoryName, (categoryMap.get(categoryName) ?? 0) + 1);
    }
    if (categoriesRegistryResult.error && !isMissingTableError(categoriesRegistryResult.error as PostgrestErrorLike)) {
      throw new Error("Failed to load category registry.");
    }
    if (!categoriesRegistryResult.error) {
      for (const row of categoriesRegistryResult.data ?? []) {
        const categoryName = String((row as { name?: string | null }).name ?? "").trim();
        if (!categoryName || categoryMap.has(categoryName)) continue;
        categoryMap.set(categoryName, 0);
      }
    }
    categoryList = Array.from(categoryMap.entries())
      .map(([name, productCount]) => ({ name, productCount }))
      .sort((a, b) => a.name.localeCompare(b.name, th ? "th" : "en"));

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
    <section className="pos-section-card w-full self-start overflow-hidden rounded-2xl border border-slate-300 bg-white">
      <div className="border-b border-slate-200 bg-[linear-gradient(130deg,#f8fbff_0%,#f2f7ff_34%,#fff7ed_100%)] px-4 py-3 lg:px-6 lg:py-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(360px,520px)_auto] lg:items-start">
          <div>
            <PosBackButton lang={lang} href="/preview/pos/more" label={lang === "th" ? "กลับเมนูเพิ่มเติม" : "Back to More"} className="mb-3" />
            <h2 className="mt-1 text-xl font-extrabold text-slate-900 lg:text-2xl">
              {t(lang, "pos_stock_title")}
            </h2>
          </div>

          <div className="lg:pt-1 [&>div]:mt-0">
            <StockBranchSelector
              th={th}
              canManageCatalog={canManageCatalog}
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
            <AddProductPopupButton
              th={th}
              categories={categoryList}
              ingredients={ingredientList}
              deliveryRates={deliveryRatesForAddProduct}
              branchId={selectedBranchId}
              disabled={!canManageCatalog}
              buttonLabel={th ? `เพิ่มสินค้า (${selectedBranchName})` : `Add Product (${selectedBranchName})`}
            />
          </div>
        </div>

        <div
          id="stock-page-action-toolbar"
          className="mt-2 flex min-h-9 flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 pt-2"
          aria-label={th ? "เครื่องมือจัดการสินค้า" : "Product management tools"}
        />
      </div>

      <div className="grid gap-3 px-4 py-3 lg:px-6 lg:py-3">
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
          />
        </div>
      </div>

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

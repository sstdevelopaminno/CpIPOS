import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type BundleLineInput = { product_id?: string; qty?: number };
type BundlePayload = {
  action?: "upsert_bundle";
  id?: string;
  sku?: string;
  name?: string;
  category?: string;
  price?: number;
  items?: BundleLineInput[];
};

type ProductSnapshot = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  is_combo: boolean;
  is_active: boolean;
  stock_deduction_mode: string | null;
  sell_unit: string | null;
  metadata: Record<string, unknown> | null;
};

type ComboSnapshot = { child_product_id: string; qty: number };
type RecipeSnapshot = {
  ingredient_id: string;
  quantity_per_item: number;
  applies_when_takeaway_only: boolean;
};

const PRODUCT_FIELDS =
  "id,sku,name,category,price,is_combo,is_active,stock_deduction_mode,sell_unit,metadata,deleted_at,updated_at";

function canManage(role: string | null) {
  return role === "owner" || role === "manager";
}

function cleanSku(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, "-").slice(0, 40);
  return normalized || fallback;
}

function normalizeItems(input: unknown): Array<{ product_id: string; qty: number }> {
  if (!Array.isArray(input)) return [];
  const merged = new Map<string, number>();
  for (const raw of input as BundleLineInput[]) {
    const productId = String(raw?.product_id ?? "").trim();
    const qty = Number(raw?.qty ?? 0);
    if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
    merged.set(productId, Number(((merged.get(productId) ?? 0) + qty).toFixed(3)));
  }
  return Array.from(merged, ([product_id, qty]) => ({ product_id, qty }));
}

async function loadBundleView(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const [{ data: bundles, error: bundleError }, { data: eligible, error: eligibleError }] = await Promise.all([
    supabase
      .from("products")
      .select(PRODUCT_FIELDS)
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("is_combo", true)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("products")
      .select("id,sku,name,category,price,is_active,is_combo,deleted_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .eq("is_combo", false)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(300)
  ]);
  if (bundleError) throw new Error(bundleError.message);
  if (eligibleError) throw new Error(eligibleError.message);

  const bundleIds = (bundles ?? []).map((row) => String(row.id));
  let comboRows: Array<{ combo_product_id: string; child_product_id: string; qty: number }> = [];
  if (bundleIds.length) {
    const result = await supabase
      .from("product_combo_items")
      .select("combo_product_id,child_product_id,qty")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .in("combo_product_id", bundleIds);
    if (result.error) throw new Error(result.error.message);
    comboRows = (result.data ?? []) as typeof comboRows;
  }

  const childIds = Array.from(new Set(comboRows.map((row) => String(row.child_product_id))));
  const childMap = new Map<string, { id: string; sku: string; name: string; price: number }>();
  if (childIds.length) {
    const result = await supabase
      .from("products")
      .select("id,sku,name,price")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .in("id", childIds);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) {
      childMap.set(String(row.id), {
        id: String(row.id),
        sku: String(row.sku ?? ""),
        name: String(row.name ?? ""),
        price: Number(row.price ?? 0)
      });
    }
  }

  const items = (bundles ?? []).map((bundle) => ({
    ...bundle,
    bundle_items: comboRows
      .filter((row) => String(row.combo_product_id) === String(bundle.id))
      .map((row) => ({
        product_id: String(row.child_product_id),
        qty: Number(row.qty ?? 0),
        product: childMap.get(String(row.child_product_id)) ?? null
      }))
  }));

  return { items, eligible_items: eligible ?? [] };
}

export async function GET() {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "bundle_products");
    return ok(await loadBundleView(auth.tenantId!, auth.branchId!));
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("bundle_query_failed", error instanceof Error ? error.message : "Unable to load bundle products.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "bundle_products");
    if (!canManage(auth.branchRole)) return fail("forbidden_role", "Only manager or owner can manage bundle products.", 403);

    const body = (await req.json()) as BundlePayload;
    if (body.action !== "upsert_bundle") return fail("invalid_action", "action must be upsert_bundle.", 422);

    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "Bundle").trim() || "Bundle";
    const price = Number(body.price ?? 0);
    const bundleId = String(body.id ?? "").trim();
    const items = normalizeItems(body.items);
    if (!name) return fail("bundle_name_required", "Bundle name is required.", 422);
    if (!Number.isFinite(price) || price < 0) return fail("bundle_price_invalid", "Bundle price must be 0 or greater.", 422);
    if (items.length < 2) return fail("bundle_items_required", "Bundle must contain at least 2 different products.", 422);
    if (bundleId && items.some((item) => item.product_id === bundleId)) return fail("bundle_recursive_item", "Bundle cannot contain itself.", 422);

    const supabase = getSupabaseServiceClient();
    const childIds = items.map((item) => item.product_id);
    const { data: childRows, error: childError } = await supabase
      .from("products")
      .select("id,sku,name,is_active,is_combo,deleted_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .in("id", childIds);
    if (childError) return fail("bundle_child_query_failed", childError.message, 500);

    const childById = new Map((childRows ?? []).map((row) => [String(row.id), row]));
    for (const childId of childIds) {
      const child = childById.get(childId);
      if (!child || child.is_active !== true || child.deleted_at) {
        return fail("bundle_child_unavailable", `Product ${childId} is not active in this branch.`, 422);
      }
      if (child.is_combo === true) return fail("nested_bundle_not_supported", "Nested bundle products are not supported.", 422);
    }

    const { data: childRecipes, error: recipeError } = await supabase
      .from("recipes")
      .select("product_id,ingredient_id,quantity_per_item,applies_when_takeaway_only")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .in("product_id", childIds);
    if (recipeError) return fail("bundle_recipe_query_failed", recipeError.message, 500);

    const recipeCountByProduct = new Map<string, number>();
    for (const recipe of childRecipes ?? []) {
      const productId = String(recipe.product_id);
      recipeCountByProduct.set(productId, (recipeCountByProduct.get(productId) ?? 0) + 1);
    }
    const missingRecipeChild = childIds.find((childId) => !recipeCountByProduct.get(childId));
    if (missingRecipeChild) {
      const label = childById.get(missingRecipeChild)?.name ?? missingRecipeChild;
      return fail("bundle_child_stock_recipe_missing", `สินค้า ${label} ยังไม่มีสูตร/ตัวเชื่อมสต๊อก จึงยังนำเข้า Bundle ไม่ได้`, 422);
    }

    const qtyByProduct = new Map(items.map((item) => [item.product_id, item.qty]));
    const aggregate = new Map<string, RecipeSnapshot>();
    for (const recipe of childRecipes ?? []) {
      const childQty = qtyByProduct.get(String(recipe.product_id)) ?? 0;
      const ingredientId = String(recipe.ingredient_id);
      const takeaway = recipe.applies_when_takeaway_only === true;
      const key = `${ingredientId}:${takeaway ? "1" : "0"}`;
      const current = aggregate.get(key) ?? {
        ingredient_id: ingredientId,
        quantity_per_item: 0,
        applies_when_takeaway_only: takeaway
      };
      current.quantity_per_item = Number((current.quantity_per_item + Number(recipe.quantity_per_item ?? 0) * childQty).toFixed(3));
      aggregate.set(key, current);
    }
    const bundleRecipes = Array.from(aggregate.values()).filter((row) => row.quantity_per_item > 0);
    if (!bundleRecipes.length) return fail("bundle_recipe_empty", "Bundle stock recipe resolved to an empty set.", 422);

    let previousProduct: ProductSnapshot | null = null;
    let previousCombo: ComboSnapshot[] = [];
    let previousRecipes: RecipeSnapshot[] = [];
    let productId = bundleId;
    let createdNew = false;

    if (bundleId) {
      const [{ data: existing, error: existingError }, { data: combo }, { data: recipes }] = await Promise.all([
        supabase
          .from("products")
          .select("id,sku,name,category,price,is_combo,is_active,stock_deduction_mode,sell_unit,metadata")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("id", bundleId)
          .eq("is_combo", true)
          .maybeSingle<ProductSnapshot>(),
        supabase
          .from("product_combo_items")
          .select("child_product_id,qty")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("combo_product_id", bundleId),
        supabase
          .from("recipes")
          .select("ingredient_id,quantity_per_item,applies_when_takeaway_only")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("product_id", bundleId)
      ]);
      if (existingError) return fail("bundle_query_failed", existingError.message, 500);
      if (!existing) return fail("bundle_not_found", "Bundle product not found.", 404);
      previousProduct = existing;
      previousCombo = (combo ?? []) as ComboSnapshot[];
      previousRecipes = (recipes ?? []) as RecipeSnapshot[];

      const { error } = await supabase
        .from("products")
        .update({
          sku: cleanSku(body.sku, existing.sku),
          name,
          category,
          price: Number(price.toFixed(2)),
          is_combo: true,
          is_active: true,
          stock_deduction_mode: "recipe_deduction",
          sell_unit: "ชุด",
          metadata: { ...(existing.metadata ?? {}), bundle_version: 1, bundle_stock_mode: "expanded_recipe" },
          updated_at: new Date().toISOString()
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", bundleId);
      if (error) return fail("bundle_update_failed", error.message, 500);
    } else {
      const sku = cleanSku(body.sku, `BND-${Date.now()}`);
      const { data, error } = await supabase
        .from("products")
        .insert({
          tenant_id: auth.tenantId!,
          branch_id: auth.branchId!,
          sku,
          name,
          category,
          price: Number(price.toFixed(2)),
          is_combo: true,
          is_active: true,
          stock_deduction_mode: "recipe_deduction",
          sell_unit: "ชุด",
          metadata: { bundle_version: 1, bundle_stock_mode: "expanded_recipe" }
        })
        .select("id")
        .single();
      if (error) return fail("bundle_insert_failed", error.message, 500);
      productId = String(data.id);
      createdNew = true;
    }

    try {
      const [comboDelete, recipeDelete] = await Promise.all([
        supabase
          .from("product_combo_items")
          .delete()
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("combo_product_id", productId),
        supabase
          .from("recipes")
          .delete()
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("product_id", productId)
      ]);
      if (comboDelete.error) throw new Error(comboDelete.error.message);
      if (recipeDelete.error) throw new Error(recipeDelete.error.message);

      const comboInsert = await supabase.from("product_combo_items").insert(
        items.map((item) => ({
          tenant_id: auth.tenantId!,
          branch_id: auth.branchId!,
          combo_product_id: productId,
          child_product_id: item.product_id,
          qty: item.qty
        }))
      );
      if (comboInsert.error) throw new Error(comboInsert.error.message);

      const recipeInsert = await supabase.from("recipes").insert(
        bundleRecipes.map((recipe) => ({
          tenant_id: auth.tenantId!,
          branch_id: auth.branchId!,
          product_id: productId,
          ingredient_id: recipe.ingredient_id,
          quantity_per_item: recipe.quantity_per_item,
          applies_when_takeaway_only: recipe.applies_when_takeaway_only
        }))
      );
      if (recipeInsert.error) throw new Error(recipeInsert.error.message);
    } catch (writeError) {
      await supabase.from("product_combo_items").delete().eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("combo_product_id", productId);
      await supabase.from("recipes").delete().eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("product_id", productId);

      if (createdNew) {
        await supabase.from("products").delete().eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("id", productId);
      } else if (previousProduct) {
        await supabase
          .from("products")
          .update({
            sku: previousProduct.sku,
            name: previousProduct.name,
            category: previousProduct.category,
            price: previousProduct.price,
            is_combo: previousProduct.is_combo,
            is_active: previousProduct.is_active,
            stock_deduction_mode: previousProduct.stock_deduction_mode,
            sell_unit: previousProduct.sell_unit,
            metadata: previousProduct.metadata
          })
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("id", productId);
        if (previousCombo.length) {
          await supabase.from("product_combo_items").insert(previousCombo.map((row) => ({
            tenant_id: auth.tenantId!, branch_id: auth.branchId!, combo_product_id: productId,
            child_product_id: row.child_product_id, qty: row.qty
          })));
        }
        if (previousRecipes.length) {
          await supabase.from("recipes").insert(previousRecipes.map((row) => ({
            tenant_id: auth.tenantId!, branch_id: auth.branchId!, product_id: productId,
            ingredient_id: row.ingredient_id, quantity_per_item: row.quantity_per_item,
            applies_when_takeaway_only: row.applies_when_takeaway_only
          })));
        }
      }
      return fail("bundle_write_failed", writeError instanceof Error ? writeError.message : "Bundle write failed.", 500);
    }

    const view = await loadBundleView(auth.tenantId!, auth.branchId!);
    return ok({ product_id: productId, created: createdNew, ...view }, createdNew ? 201 : 200);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("bundle_action_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}

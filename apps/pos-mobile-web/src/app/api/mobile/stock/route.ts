import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type IngredientRow = {
  id: string;
  name: string | null;
  base_unit: string | null;
  quantity_on_hand: number | null;
  reorder_level: number | null;
  updated_at: string | null;
};

type ProductRow = {
  id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  price: number | null;
  is_active: boolean | null;
  stock_deduction_mode: string | null;
  updated_at: string | null;
};

type CategoryRow = {
  name: string | null;
};

type MovementRow = {
  id: string;
  ingredient_id: string | null;
  quantity_delta: number | null;
  reason: string | null;
  created_at: string | null;
};

const productSchema = z.object({
  kind: z.literal("product"),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80).default("ทั่วไป"),
  price: z.coerce.number().min(0).max(1_000_000),
  sku: z.string().trim().max(80).optional(),
});

const ingredientSchema = z.object({
  kind: z.literal("ingredient"),
  name: z.string().trim().min(1).max(160),
  baseUnit: z.string().trim().min(1).max(40).default("piece"),
  quantityOnHand: z.coerce.number().min(0).max(1_000_000).default(0),
  reorderLevel: z.coerce.number().min(0).max(1_000_000).default(0),
});

const createSchema = z.discriminatedUnion("kind", [productSchema, ingredientSchema]);

const updateSchema = z.discriminatedUnion("kind", [
  productSchema.extend({ id: z.string().uuid(), isActive: z.boolean().optional() }),
  ingredientSchema.extend({ id: z.string().uuid() }),
]);

const deleteSchema = z.object({
  kind: z.enum(["product", "ingredient"]),
  id: z.string().uuid(),
});

const restockSchema = z.object({
  ingredientId: z.string().uuid(),
  quantityDelta: z.coerce.number().min(-1_000_000).max(1_000_000).refine((value) => value !== 0),
  reason: z.string().trim().max(160).optional(),
});

function toStockStatus(row: IngredientRow) {
  const quantity = Number(row.quantity_on_hand ?? 0);
  const reorder = Number(row.reorder_level ?? 0);
  if (quantity <= 0) return "out";
  if (reorder > 0 && quantity <= reorder) return "low";
  return "ok";
}

async function readScope() {
  const scope = await requireActiveMobileSession({ refreshCookie: true });
  if (!scope) return { scope: null, error: fail("missing_session", "กรุณาเข้าสู่ระบบ", 401) };
  if (!["owner", "manager", "staff"].includes(scope.role)) return { scope: null, error: fail("forbidden", "ไม่มีสิทธิ์จัดการสต๊อก", 403) };
  return { scope, error: null };
}

function makeSku(name: string) {
  const compact = name.trim().replace(/\s+/g, "-").slice(0, 28).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `MOB-${compact || "ITEM"}-${suffix}`;
}

export async function GET() {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์ดูสต๊อก", 403);

    const supabase = createServiceClient();
    const [productsResult, ingredientsResult, movementsResult, categoriesResult] = await Promise.all([
      supabase
        .from("products")
        .select("id,sku,name,category,price,is_active,stock_deduction_mode,updated_at")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .order("category", { ascending: true })
        .order("name", { ascending: true })
        .limit(100),
      supabase
        .from("ingredients")
        .select("id,name,base_unit,quantity_on_hand,reorder_level,updated_at")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .order("quantity_on_hand", { ascending: true })
        .order("name", { ascending: true })
        .limit(100),
      supabase
        .from("stock_movements")
        .select("id,ingredient_id,quantity_delta,reason,created_at")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .eq("movement_type", "sale_deduction")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("product_categories")
        .select("name")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .order("name", { ascending: true }),
    ]);

    if (productsResult.error) return fail("products_query_failed", productsResult.error.message, 500);
    if (ingredientsResult.error) return fail("ingredients_query_failed", ingredientsResult.error.message, 500);
    if (movementsResult.error) return fail("stock_movements_query_failed", movementsResult.error.message, 500);
    if (categoriesResult.error) return fail("categories_query_failed", categoriesResult.error.message, 500);

    const ingredients = ((ingredientsResult.data ?? []) as IngredientRow[]).map((row) => ({
      id: row.id,
      name: row.name ?? "-",
      baseUnit: row.base_unit ?? "",
      quantityOnHand: Number(row.quantity_on_hand ?? 0),
      reorderLevel: Number(row.reorder_level ?? 0),
      updatedAt: row.updated_at,
      status: toStockStatus(row),
    }));

    return ok({
      products: ((productsResult.data ?? []) as ProductRow[]).map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name ?? "-",
        category: row.category ?? "-",
        price: Number(row.price ?? 0),
        isActive: Boolean(row.is_active),
        stockDeductionMode: row.stock_deduction_mode ?? "unit_only",
        updatedAt: row.updated_at,
      })),
      categories: ((categoriesResult.data ?? []) as CategoryRow[]).map((row) => row.name).filter((name): name is string => Boolean(name)),
      ingredients,
      recentSaleDeductions: ((movementsResult.data ?? []) as MovementRow[]).map((row) => ({
        id: row.id,
        ingredientId: row.ingredient_id,
        quantityDelta: Number(row.quantity_delta ?? 0),
        reason: row.reason,
        createdAt: row.created_at,
      })),
      summary: {
        activeProducts: ((productsResult.data ?? []) as ProductRow[]).filter((item) => item.is_active).length,
        categories: new Set(((productsResult.data ?? []) as ProductRow[]).map((item) => String(item.category ?? "-"))).size,
        trackedIngredients: ingredients.length,
        lowIngredients: ingredients.filter((item) => item.status === "low").length,
        outIngredients: ingredients.filter((item) => item.status === "out").length,
      },
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[mobile.stock]", error);
    return fail("stock_query_failed", error instanceof Error ? error.message : "โหลดสต๊อกไม่สำเร็จ", 503);
  }
}

export async function POST(request: Request) {
  try {
    const { scope, error: scopeError } = await readScope();
    if (!scope) return scopeError;
    const body = createSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลสินค้า/วัตถุดิบไม่ถูกต้อง", 422);

    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();
    if (body.data.kind === "product") {
      const { error } = await supabase.from("products").insert({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        sku: body.data.sku || makeSku(body.data.name),
        name: body.data.name,
        category: body.data.category,
        price: body.data.price,
        is_active: true,
        stock_deduction_mode: "unit_only",
        sell_unit: "unit",
        metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web" },
      });
      if (error) return fail("product_create_failed", error.message, 500);
      await appendMobileAuditLog({
        scope,
        action: "mobile_product_created",
        targetTable: "products",
        metadata: { name: body.data.name, category: body.data.category, price: body.data.price },
        afterData: { kind: "product", name: body.data.name, category: body.data.category, price: body.data.price },
      });
      return ok({ created: true });
    }

    const { error } = await supabase.from("ingredients").insert({
      tenant_id: scope.tenantId,
      branch_id: scope.branchId,
      name: body.data.name,
      base_unit: body.data.baseUnit,
      quantity_on_hand: body.data.quantityOnHand,
      reorder_level: body.data.reorderLevel,
      updated_at: nowIso,
    });
    if (error) return fail("ingredient_create_failed", error.message, 500);
    await appendMobileAuditLog({
      scope,
      action: "mobile_ingredient_created",
      targetTable: "ingredients",
      metadata: { name: body.data.name, base_unit: body.data.baseUnit, quantity_on_hand: body.data.quantityOnHand },
      afterData: { kind: "ingredient", name: body.data.name, base_unit: body.data.baseUnit, quantity_on_hand: body.data.quantityOnHand },
    });
    return ok({ created: true });
  } catch (error) {
    console.error("[mobile.stock.create]", error);
    return fail("stock_create_failed", error instanceof Error ? error.message : "บันทึกไม่สำเร็จ", 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const { scope, error: scopeError } = await readScope();
    if (!scope) return scopeError;
    const payload = await request.json().catch(() => ({}));

    if (payload?.action === "restock") {
      const body = restockSchema.safeParse(payload);
      if (!body.success) return fail("invalid_input", "จำนวนที่ปรับไม่ถูกต้อง", 422);
      const supabase = createServiceClient();
      const { data: ingredient, error: readError } = await supabase
        .from("ingredients")
        .select("id,quantity_on_hand")
        .eq("id", body.data.ingredientId)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .maybeSingle<{ id: string; quantity_on_hand: number }>();
      if (readError) return fail("ingredient_query_failed", readError.message, 500);
      if (!ingredient) return fail("ingredient_not_found", "ไม่พบวัตถุดิบ", 404);

      const nextQuantity = Math.max(0, Number(ingredient.quantity_on_hand ?? 0) + body.data.quantityDelta);
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("ingredients")
        .update({ quantity_on_hand: nextQuantity, updated_at: nowIso })
        .eq("id", ingredient.id)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId);
      if (updateError) return fail("ingredient_restock_failed", updateError.message, 500);

      await supabase.from("stock_movements").insert({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        ingredient_id: ingredient.id,
        movement_type: body.data.quantityDelta > 0 ? "purchase" : "waste",
        quantity_delta: nextQuantity - Number(ingredient.quantity_on_hand ?? 0),
        reason: body.data.reason || "Mobile stock adjustment",
        ref_table: "ingredients",
        ref_id: ingredient.id,
        created_by: scope.userId,
        request_id: `mobile-stock-${crypto.randomUUID()}`,
      });

      await appendMobileAuditLog({
        scope,
        action: "mobile_ingredient_restocked",
        targetTable: "ingredients",
        targetId: ingredient.id,
        metadata: { quantity_delta: body.data.quantityDelta, quantity_before: Number(ingredient.quantity_on_hand ?? 0), quantity_after: nextQuantity, reason: body.data.reason || "Mobile stock adjustment" },
        beforeData: { quantity_on_hand: Number(ingredient.quantity_on_hand ?? 0) },
        afterData: { quantity_on_hand: nextQuantity },
      });

      return ok({ updated: true, quantityOnHand: nextQuantity });
    }

    const body = updateSchema.safeParse(payload);
    if (!body.success) return fail("invalid_input", "ข้อมูลที่แก้ไขไม่ถูกต้อง", 422);
    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();

    if (body.data.kind === "product") {
      const { error } = await supabase
        .from("products")
        .update({
          name: body.data.name,
          category: body.data.category,
          price: body.data.price,
          is_active: body.data.isActive ?? true,
          updated_at: nowIso,
        })
        .eq("id", body.data.id)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId);
      if (error) return fail("product_update_failed", error.message, 500);
      await appendMobileAuditLog({
        scope,
        action: "mobile_product_updated",
        targetTable: "products",
        targetId: body.data.id,
        metadata: { name: body.data.name, category: body.data.category, price: body.data.price, is_active: body.data.isActive ?? true },
        afterData: { kind: "product", name: body.data.name, category: body.data.category, price: body.data.price, is_active: body.data.isActive ?? true },
      });
      return ok({ updated: true });
    }

    const { error } = await supabase
      .from("ingredients")
      .update({
        name: body.data.name,
        base_unit: body.data.baseUnit,
        quantity_on_hand: body.data.quantityOnHand,
        reorder_level: body.data.reorderLevel,
        updated_at: nowIso,
      })
      .eq("id", body.data.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId);
    if (error) return fail("ingredient_update_failed", error.message, 500);
    await appendMobileAuditLog({
      scope,
      action: "mobile_ingredient_updated",
      targetTable: "ingredients",
      targetId: body.data.id,
      metadata: { name: body.data.name, base_unit: body.data.baseUnit, quantity_on_hand: body.data.quantityOnHand, reorder_level: body.data.reorderLevel },
      afterData: { kind: "ingredient", name: body.data.name, base_unit: body.data.baseUnit, quantity_on_hand: body.data.quantityOnHand, reorder_level: body.data.reorderLevel },
    });
    return ok({ updated: true });
  } catch (error) {
    console.error("[mobile.stock.update]", error);
    return fail("stock_update_failed", error instanceof Error ? error.message : "แก้ไขไม่สำเร็จ", 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const { scope, error: scopeError } = await readScope();
    if (!scope) return scopeError;
    const body = deleteSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลลบไม่ถูกต้อง", 422);
    const supabase = createServiceClient();

    if (body.data.kind === "product") {
      const { error } = await supabase
        .from("products")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", body.data.id)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId);
      if (error) return fail("product_delete_failed", error.message, 500);
      await appendMobileAuditLog({
        scope,
        action: "mobile_product_deleted",
        targetTable: "products",
        targetId: body.data.id,
        metadata: { kind: "product", soft_deleted: true },
        afterData: { is_active: false },
      });
      return ok({ deleted: true, softDeleted: true });
    }

    const { error } = await supabase
      .from("ingredients")
      .delete()
      .eq("id", body.data.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId);
    if (error) return fail("ingredient_delete_failed", "วัตถุดิบนี้ถูกใช้งานอยู่ ลบไม่ได้ ให้แก้จำนวนเป็น 0 แทน", 409);
    await appendMobileAuditLog({
      scope,
      action: "mobile_ingredient_deleted",
      targetTable: "ingredients",
      targetId: body.data.id,
      metadata: { kind: "ingredient" },
      afterData: { deleted: true },
    });
    return ok({ deleted: true });
  } catch (error) {
    console.error("[mobile.stock.delete]", error);
    return fail("stock_delete_failed", error instanceof Error ? error.message : "ลบไม่สำเร็จ", 503);
  }
}

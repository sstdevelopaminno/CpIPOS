import { fail, ok } from "@/lib/http";
import { appendAuditLog } from "@/lib/audit-log";
import { FeatureGateError } from "@/lib/feature-gate";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getRecyclingPriceBasis, isRecyclingPriceUnit, parseRecyclingUnitPrice } from "@/lib/recycling-price-units";
import { getRecyclingStockBranches, requireRecyclingStockBranch } from "@/lib/server/recycling-stock-branch-scope";

type CatalogPayload = {
  id?: unknown;
  branch_id?: unknown;
  sku?: unknown;
  name?: unknown;
  category?: unknown;
  price_basis?: unknown;
  price_unit?: unknown;
  buy_price?: unknown;
  sell_price?: unknown;
  image_url?: unknown;
};

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    const { tenant_id: tenantId, role } = scope.session;
    if (role !== "owner" && role !== "manager") {
      return fail("recycling_catalog_forbidden", "Only owner and manager may change recycling material prices.", 403);
    }
    if (!await isAuthorizedRecyclingTenant(tenantId)) {
      return fail("recycling_not_authorized", "CUSTOM Recycling mode is not active for this tenant.", 403);
    }
    const body = await request.json().catch(() => null) as CatalogPayload | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_payload", "Invalid payload.", 422);
    // A catalog create/edit explicitly targets a branch. Never use an
    // untrusted client-supplied branch without rechecking target membership.
    const requestedBranchId = typeof body.branch_id === "string" ? body.branch_id.trim() : "";
    if (!requestedBranchId) return fail("recycling_branch_required", "กรุณาเลือกสาขาก่อนเพิ่มหรือแก้ไขวัสดุ", 422);
    const branches = await getRecyclingStockBranches(scope);
    const selectedBranch = requireRecyclingStockBranch(requestedBranchId, branches, true);
    const branchId = selectedBranch.id;
    await requirePosApiFeature({ tenantId, branchId }, "stock_management");
    const sku = String(body.sku ?? "").trim();
    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "").trim();
    const priceBasis = body.price_basis === "piece" ? "piece" : body.price_basis === "kg" ? "kg" : null;
    // Old clients omit price_unit and keep canonical baht/kg or baht/piece input.
    const priceUnit = body.price_unit === undefined ? priceBasis : body.price_unit;
    if (!isRecyclingPriceUnit(priceUnit) || getRecyclingPriceBasis(priceUnit) !== priceBasis) {
      return fail("recycling_price_unit_invalid", "Price unit does not match stock price basis.", 422);
    }
    const buyPrice = parseRecyclingUnitPrice(body.buy_price, priceUnit);
    const sellPrice = parseRecyclingUnitPrice(body.sell_price, priceUnit);
    if (!sku || sku.length > 90 || !name || name.length > 200 || !category || category.length > 120 ||
        !priceBasis || buyPrice === null || sellPrice === null) {
      return fail("invalid_material", "Name, category, SKU, price basis and both nonnegative prices are required.", 422);
    }
    const imageUrl = String(body.image_url ?? "").trim();
    if (imageUrl.length > 1000 || (imageUrl && !/^https:\/\/[^\s]+$/i.test(imageUrl))) {
      return fail("invalid_image_url", "Only an HTTPS image URL is allowed.", 422);
    }

    const db = getSupabaseServiceClient();
    const id = typeof body.id === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(body.id)
      ? body.id : null;
    let metadata: Record<string, unknown> = {};
    if (id) {
      const { data: existing, error } = await db.from("products")
        .select("id,sell_unit,metadata").eq("id", id).eq("tenant_id", tenantId)
        .eq("branch_id", branchId).is("deleted_at", null).maybeSingle();
      if (error) return fail("recycling_material_lookup_failed", "Unable to load material.", 500);
      if (!existing) return fail("recycling_material_missing", "Material does not belong to the current branch.", 404);
      metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
        ? existing.metadata as Record<string, unknown> : {};
      if (metadata.business_mode !== "recycling") {
        return fail("not_recycling_material", "Cannot change an unrelated POS product from Recycling catalog.", 403);
      }
      const previousBasis = metadata.recycling_price_basis === "piece" || existing.sell_unit === "piece" ? "piece" : "kg";
      // Unit changes need a controlled stock conversion/migration workflow.
      if (previousBasis === "piece" && (metadata.recycling_price_unit ?? "piece") !== priceUnit) return fail("count_unit_locked", "กรุณาสร้าง SKU ใหม่เมื่อเปลี่ยนหน่วยนับ ไม่สามารถเปลี่ยนหน่วยนับของสต๊อกเดิมได้",409);
      if (previousBasis !== priceBasis) return fail("price_basis_locked", "Material price basis cannot be changed after creation.", 409);
    }
    const patch = {
      sku, name, category,
      price: sellPrice,
      sell_unit: priceBasis,
      stock_deduction_mode: "unit_only" as const,
      metadata: {
        ...metadata,
        business_mode: "recycling",
        recycling_price_basis: priceBasis,
        recycling_price_unit: priceUnit,
        recycling_buy_price: buyPrice,
        image_url: imageUrl || null
      }
    };
    const query = id
      ? db.from("products").update(patch).eq("id", id).eq("tenant_id", tenantId).eq("branch_id", branchId)
      : db.from("products").insert({ ...patch, tenant_id: tenantId, branch_id: branchId, is_active: true });
    const { data, error } = await query.select("id,sku,name,category,price,sell_unit,metadata").single();
    if (error) {
      if (error.code === "23505") return fail("duplicate_material_sku", "This barcode/SKU is already registered for this branch.", 409);
      return fail("recycling_catalog_save_failed", "Unable to save material.", 500);
    }
    return ok({ material: data });
  } catch (error) {
    if (error instanceof PosGuardError || error instanceof FeatureGateError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("recycling_catalog_failed", "Unable to save recycling material.", 500);
  }
}

/**
 * Recycling-only material removal. Soft deletion keeps historic transaction
 * foreign keys, receipts and financial ledgers intact. Never touch standard
 * package products, another tenant, or an unassigned branch.
 */
export async function DELETE(request: Request) {
  try {
    const scope = await requirePosSession();
    const { tenant_id: tenantId, role, user_id: actorId } = scope.session;
    if (role !== "owner" && role !== "manager") {
      return fail("recycling_catalog_delete_forbidden", "เฉพาะเจ้าของร้านหรือผู้จัดการจึงลบรายการวัสดุได้", 403);
    }
    if (!await isAuthorizedRecyclingTenant(tenantId)) {
      return fail("recycling_not_authorized", "ไม่สามารถจัดการทะเบียนวัสดุจากแพ็กเกจนี้ได้", 403);
    }
    const body = await request.json().catch(() => null) as {
      branch_id?: unknown; id?: unknown; delete_all?: unknown;
      expected_count?: unknown; confirmation?: unknown;
    } | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail("invalid_payload", "ข้อมูลยืนยันการลบไม่ถูกต้อง", 422);
    }
    const requestedBranchId = typeof body.branch_id === "string" ? body.branch_id.trim() : "";
    if (!requestedBranchId) return fail("recycling_branch_required", "กรุณาเลือกสาขาที่ต้องการลบ", 422);
    const branches = await getRecyclingStockBranches(scope);
    const branch = requireRecyclingStockBranch(requestedBranchId, branches, true);
    const branchId = branch.id;
    await requirePosApiFeature({ tenantId, branchId }, "stock_management");

    const deleteAll = body.delete_all === true;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (deleteAll) {
      if (id || body.confirmation !== "ลบทั้งหมด" ||
          typeof body.expected_count !== "number" || !Number.isSafeInteger(body.expected_count) || body.expected_count <= 0) {
        return fail("recycling_delete_all_confirmation_required", "ต้องยืนยันข้อความ ลบทั้งหมด และจำนวนรายการให้ถูกต้อง", 422);
      }
    } else if (!uuid.test(id) || body.confirmation !== "ลบรายการนี้") {
      return fail("recycling_delete_confirmation_required", "ต้องยืนยันการลบวัสดุที่เลือก", 422);
    }

    const db = getSupabaseServiceClient();
    // The metadata + status predicates are enforced server-side, not inferred
    // from the visible UI. Never include unrelated catalog products.
    let select = db.from("products").select("id,sku,name")
      .eq("tenant_id", tenantId).eq("branch_id", branchId)
      .eq("is_active", true).is("deleted_at", null)
      .contains("metadata", {business_mode:"recycling"});
    if (!deleteAll) select = select.eq("id", id);
    const { data: materials, error: selectError } = await select.limit(1001);
    if (selectError) return fail("recycling_material_lookup_failed", "ตรวจสอบรายการวัสดุก่อนลบไม่สำเร็จ", 503);
    if (!materials?.length) {
      return fail("recycling_material_missing", "ไม่พบรายการวัสดุที่ยังใช้งานในสาขานี้", 404);
    }
    if (materials.length > 1000) {
      return fail("recycling_material_bulk_limit", "รายการเกิน 1,000 รายการ กรุณาติดต่อ IT สำหรับการลบเป็นชุด", 409);
    }
    if (deleteAll && materials.length !== body.expected_count) {
      return fail("recycling_material_list_changed", "จำนวนวัสดุเปลี่ยนไปแล้ว กรุณารีเฟรชและยืนยันใหม่", 409);
    }
    const ids = materials.map(item => item.id);

    // Only zero-balance stock may be removed from the *active* catalog.
    // An unavailable ledger is an error, NOT an assumed zero balance.
    const {data:balances,error:balanceError} = await db.from("recycling_stock_balances")
      .select("product_id,quantity_base")
      .eq("tenant_id", tenantId).eq("branch_id", branchId)
      .in("product_id", ids).limit(1001);
    if (balanceError) return fail("recycling_stock_verification_failed",
      "ไม่สามารถตรวจสอบยอดคงเหลือได้ จึงยังไม่ลบวัสดุ", 503);
    const nonzero = (balances ?? []).filter(row =>
      !Number.isFinite(Number(row.quantity_base)) || Number(row.quantity_base) !== 0
    );
    if (nonzero.length) {
      return fail("recycling_material_has_stock",
        "มีวัสดุที่ยังมีสต๊อกคงเหลือหรือยอดผิดปกติ กรุณาตรวจนับและปรับยอดให้ถูกต้องก่อนลบ", 409);
    }

    // One scoped update for the entire confirmed set: no row-by-row partial
    // deletion. Retain SKU and historic transaction/product references.
    const deletedAt = new Date().toISOString();
    const {data:deleted,error:updateError} = await db.from("products")
      .update({is_active:false,deleted_at:deletedAt})
      .eq("tenant_id",tenantId).eq("branch_id",branchId)
      .eq("is_active",true).is("deleted_at",null)
      .contains("metadata",{business_mode:"recycling"})
      .in("id",ids).select("id");
    if (updateError) {
      return fail("recycling_material_delete_failed", "ไม่สามารถลบทะเบียนวัสดุได้ กรุณาลองใหม่", 500);
    }
    if ((deleted ?? []).length !== ids.length) {
      return fail("recycling_material_delete_concurrent_change",
        "รายการวัสดุเปลี่ยนระหว่างการบันทึก กรุณารีเฟรชเพื่อตรวจสอบรายการที่เหลือ", 409);
    }

    const audit = await appendAuditLog({
      tenantId,branchId,actorUserId:actorId,
      actorRole:role,
      action:deleteAll?"recycling_materials_soft_deleted_bulk":"recycling_material_soft_deleted",
      targetTable:"products",
      targetId:deleteAll ? undefined : id,
      module:"recycling_stock",
      metadata:{business_mode:"recycling",delete_all:deleteAll,
        count:ids.length,material_ids:ids,deleted_at:deletedAt,
        affected_skus:materials.map(item=>item.sku)}
    });
    if (!audit.inserted) {
      console.error("[recycling-catalog] soft delete completed but audit writing failed",{
        tenantId,branchId,count:ids.length
      });
    }
    return ok({deleted_count:ids.length,scope:"recycling",branch_id:branchId});
  } catch (error) {
    if (error instanceof PosGuardError || error instanceof FeatureGateError) {
      return fail(error.code,error.message,error.status);
    }
    console.error("[recycling-catalog] material delete failed",error);
    return fail("recycling_material_delete_failed","ลบวัสดุไม่สำเร็จ กรุณาลองใหม่",500);
  }
}

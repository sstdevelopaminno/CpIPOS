export type PosItemIngredientAdjustment = {
  product_id: string;
  quantity: number;
  mode: "deduct" | "restore";
  ingredient_ids: string[];
  note: string | null;
};

type ValidationResult =
  | { ok: true; data: PosItemIngredientAdjustment }
  | { ok: false; code: string; message: string; status: 422 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Never default malformed manual stock adjustment requests to "deduct all".
 * This is a dangerous write endpoint; the operator must explicitly choose
 * the action and at least one real recipe ingredient.
 */
export function validatePosItemIngredientAdjustment(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "invalid_body", message: "Adjustment request must be an object.", status: 422 };
  }
  const input = body as Record<string, unknown>;
  const productId = typeof input.product_id === "string" ? input.product_id.trim() : "";
  if (!UUID.test(productId)) {
    return { ok: false, code: "invalid_product_id", message: "Valid product_id is required.", status: 422 };
  }
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) {
    return { ok: false, code: "invalid_quantity", message: "Quantity must be finite and between 0 and 9999.", status: 422 };
  }
  const mode = input.mode;
  if (mode !== "deduct" && mode !== "restore") {
    return { ok: false, code: "invalid_stock_mode", message: "Select deduct or restore explicitly.", status: 422 };
  }
  if (!Array.isArray(input.ingredient_ids) || input.ingredient_ids.length < 1 || input.ingredient_ids.length > 100 ||
      input.ingredient_ids.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return { ok: false, code: "invalid_ingredient_selection", message: "Select valid recipe ingredient IDs.", status: 422 };
  }
  const ids = Array.from(new Set(input.ingredient_ids as string[]));
  const note = typeof input.note === "string" ? input.note.trim() : null;
  if (note && note.length > 240) {
    return { ok: false, code: "invalid_adjustment_note", message: "Adjustment note is too long.", status: 422 };
  }
  return {
    ok: true,
    data: { product_id: productId, quantity, mode, ingredient_ids: ids, note }
  };
}

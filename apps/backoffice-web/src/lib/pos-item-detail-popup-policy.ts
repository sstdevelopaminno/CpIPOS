/** Recipe-linked products always require ingredient selection. */
export function shouldOpenPosItemDetailPopup(
  product: { has_recipe_deduction?: boolean | null },
  itemDetailPopupEnabled: boolean
): boolean {
  return itemDetailPopupEnabled || product.has_recipe_deduction === true;
}

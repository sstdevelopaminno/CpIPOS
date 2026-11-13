export type KitchenCancellationOrderLine = {
  id: string;
  product_id: string;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
};

export type KitchenCancellationRemainingLine = {
  product_id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  note: string | null;
  line_total: number;
  native_selection?: Record<string, unknown>;
};

/** Preserve the original Native cart identity when replacing a queued bill. */
export function buildKitchenCancellationRemainingLines(
  lines: KitchenCancellationOrderLine[],
  cancelledOrderItemId: string
): { ok: true; lines: KitchenCancellationRemainingLine[] } | { ok: false; code: string } {
  const active = lines.filter((line) => Number(line.quantity ?? 0) > 0 &&
    String(line.metadata?.bill_line_state ?? "") !== "cancelled");
  const hasNativeLine = active.some((line) =>
    Object.prototype.hasOwnProperty.call(line.metadata ?? {}, "native_selection"));
  const remaining = active.filter((line) => line.id !== cancelledOrderItemId);
  if (hasNativeLine && remaining.some((line) =>
    !Object.prototype.hasOwnProperty.call(line.metadata ?? {}, "native_selection"))) {
    // The current database RPC rejects mixed Native and legacy snapshots.
    // Do not invent cart IDs for legacy lines: that would cancel and re-add
    // them, producing duplicate kitchen tickets and changing stock movements.
    return { ok: false, code: "kitchen_cancel_mixed_native_bill_unsupported" };
  }

  const seenCartLineIds = new Set<string>();
  const output: KitchenCancellationRemainingLine[] = [];
  for (const line of remaining) {
    const selection = line.metadata?.native_selection;
    let nativeSelection: Record<string, unknown> | undefined;
    if (selection !== undefined) {
      if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
        return { ok: false, code: "kitchen_cancel_native_snapshot_invalid" };
      }
      nativeSelection = selection as Record<string, unknown>;
      const cartLineId = nativeSelection.cart_line_id;
      if (typeof cartLineId !== "string" || !cartLineId.trim() || seenCartLineIds.has(cartLineId)) {
        return { ok: false, code: "kitchen_cancel_native_snapshot_invalid" };
      }
      seenCartLineIds.add(cartLineId);
    }
    const note = line.notes ? String(line.notes) : null;
    output.push({
      product_id: String(line.product_id),
      quantity: Number(line.quantity ?? 0),
      unit_price: Number(line.unit_price ?? 0),
      notes: note,
      note,
      line_total: Number(line.line_total ?? 0),
      ...(nativeSelection ? { native_selection: nativeSelection } : {})
    });
  }
  return { ok: true, lines: output };
}

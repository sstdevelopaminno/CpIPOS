// Pure domain rules; persistence must use one database transaction per command.
export type WarehouseTransferStatus = "draft" | "approved" | "in_transit" | "partially_received" | "received" | "cancelled";
export type WarehouseTransferLine = Readonly<{ sku: string; quantity: number; received: number }>;
export type WarehouseTransfer = Readonly<{ status: WarehouseTransferStatus; lines: readonly WarehouseTransferLine[] }>;
export type WarehouseTransferCommand =
  | { type: "approve" }
  | { type: "dispatch" }
  | { type: "receive"; quantities: Readonly<Record<string, number>> }
  | { type: "cancel" };

function whole(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateWarehouseTransfer(transfer: WarehouseTransfer): void {
  if (!transfer.lines.length) throw new Error("EMPTY_TRANSFER");
  const seen = new Set<string>();
  for (const line of transfer.lines) {
    if (!line.sku.trim() || seen.has(line.sku) || !whole(line.quantity) || line.quantity === 0 ||
        !whole(line.received) || line.received > line.quantity) throw new Error("INVALID_TRANSFER_LINE");
    seen.add(line.sku);
  }
  const anyReceived = transfer.lines.some(line => line.received > 0);
  const allReceived = transfer.lines.every(line => line.received === line.quantity);
  if (transfer.status === "received" ? !allReceived :
      transfer.status === "partially_received" ? !anyReceived || allReceived : anyReceived) {
    throw new Error("INVALID_TRANSFER_STATUS");
  }
}

// Approval and actor checks belong to the server, not this state machine.
export function transitionWarehouseTransfer(transfer: WarehouseTransfer, command: WarehouseTransferCommand): WarehouseTransfer {
  validateWarehouseTransfer(transfer);
  const { status, lines } = transfer;
  switch (command.type) {
    case "approve":
      if (status !== "draft") throw new Error("INVALID_TRANSITION");
      return { status: "approved", lines };
    case "dispatch":
      if (status !== "approved") throw new Error("INVALID_TRANSITION");
      return { status: "in_transit", lines };
    case "cancel":
      if (status !== "draft" && status !== "approved") throw new Error("INVALID_TRANSITION");
      return { status: "cancelled", lines };
    case "receive": {
      if (status !== "in_transit" && status !== "partially_received") throw new Error("INVALID_TRANSITION");
      const requested = new Map(Object.entries(command.quantities));
      const allowed = new Set(lines.map(line => line.sku));
      for (const [sku, quantity] of requested) {
        if (!allowed.has(sku) || !whole(quantity)) throw new Error("INVALID_RECEIPT");
      }
      if (![...requested.values()].some(quantity => quantity > 0)) throw new Error("EMPTY_RECEIPT");
      const next = lines.map(line => {
        const quantity = requested.get(line.sku) ?? 0;
        if (quantity > line.quantity - line.received) throw new Error("OVER_RECEIPT");
        return { ...line, received: line.received + quantity };
      });
      return { status: next.every(line => line.received === line.quantity) ? "received" : "partially_received", lines: next };
    }
  }
}

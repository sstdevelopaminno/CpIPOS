from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8-sig")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, got {count}")
    return text.replace(old, new, 1)


# Global QR alert: stay on mounted POS and dispatch an in-page table switch.
path = "apps/backoffice-web/src/components/pos-preview/pos-table-qr-global-alert.tsx"
s = read(path)
s = replace_once(
    s,
    'const ACKED_EVENT_IDS_KEY = "pos_global_table_qr_acked_event_ids_v1";\n',
    'const ACKED_EVENT_IDS_KEY = "pos_global_table_qr_acked_event_ids_v1";\nconst DINE_IN_SELECTED_TABLE_KEY = "pos_dine_in_selected_table_v001";\nconst POS_OPEN_DINE_IN_TABLE_EVENT = "pos:open-dine-in-table";\n',
    "global alert constants",
)
s = replace_once(
    s,
    '''    if (action === "go_to_table") {\n      try { localStorage.setItem("pos_dine_in_selected_table_v001", current.table_id); } catch { /* ignore */ }\n      window.location.assign("/preview/pos");\n    }\n''',
    '''    if (action === "go_to_table") {\n      try { localStorage.setItem(DINE_IN_SELECTED_TABLE_KEY, current.table_id); } catch { /* ignore */ }\n      if (window.location.pathname === "/preview/pos") {\n        window.dispatchEvent(new CustomEvent(POS_OPEN_DINE_IN_TABLE_EVENT, {\n          detail: { tableId: current.table_id, startedAt: performance.now() }\n        }));\n        return;\n      }\n      window.location.assign("/preview/pos");\n    }\n''',
    "global alert go_to_table",
)
write(path, s)

# POS sales: fast same-page table switch + FG0003 reduction-only server sync.
path = "apps/backoffice-web/src/components/pos/pos-sales-module.tsx"
s = read(path)
s = replace_once(
    s,
    'const DINE_IN_SELECTED_TABLE_KEY = "pos_dine_in_selected_table_v001";\nconst TABLE_QR_ACTIVITY_SEEN_KEY = "pos_table_qr_activity_seen_v001";\n',
    'const DINE_IN_SELECTED_TABLE_KEY = "pos_dine_in_selected_table_v001";\nconst POS_OPEN_DINE_IN_TABLE_EVENT = "pos:open-dine-in-table";\nconst TABLE_QR_ACTIVITY_SEEN_KEY = "pos_table_qr_activity_seen_v001";\n',
    "sales event constant",
)
s = replace_once(
    s,
    "  cart: CartItem[];\n  signature: string;\n",
    "  cart: CartItem[];\n  localDraftCart?: CartItem[];\n  signature: string;\n",
    "auto send local draft field",
)
effect_anchor = '''  useEffect(() => {\n    selectedTableRef.current = selectedTable;\n    cartRef.current = cart;\n  }, [selectedTable, cart]);\n\n'''
effect_new = effect_anchor + '''  useEffect(() => {\n    if (!isHydrated || typeof window === "undefined") return;\n    const handleOpenDineInTable = (event: Event) => {\n      const detail = (event as CustomEvent<{ tableId?: string; startedAt?: number }>).detail;\n      const tableId = String(detail?.tableId ?? "").trim();\n      if (!tableId) return;\n      const startedAt = Number(detail?.startedAt);\n      const reportSwitch = () => {\n        if (!Number.isFinite(startedAt)) return;\n        reportEndpointPerf(\n          "/preview/pos/go-to-table",\n          Math.max(0, Math.round(performance.now() - startedAt)),\n          null,\n          "qr_go_to_table_same_page"\n        );\n      };\n\n      const currentTable = selectedTableRef.current;\n      if (orderType === "dine_in" && !tableBrowserOpen && currentTable?.id === tableId) {\n        reportSwitch();\n        return;\n      }\n\n      const target = posTables.find((table) => table.id === tableId);\n      if (target) {\n        void selectTableFromBrowser(target).finally(reportSwitch);\n        return;\n      }\n\n      setQuickMode("dine_in");\n      setOrderType("dine_in");\n      setTableBrowserOpen(false);\n      setPendingRestoreTableId(tableId);\n      void fetchPosTablesRef.current({ timeoutMs: 8000, retries: 0, silent: true })\n        .then((tables) => {\n          const loadedTarget = tables.find((table) => table.id === tableId);\n          if (loadedTarget) return selectTableFromBrowser(loadedTarget);\n        })\n        .catch(() => undefined)\n        .finally(reportSwitch);\n    };\n    window.addEventListener(POS_OPEN_DINE_IN_TABLE_EVENT, handleOpenDineInTable);\n    return () => window.removeEventListener(POS_OPEN_DINE_IN_TABLE_EVENT, handleOpenDineInTable);\n  }, [isHydrated, orderType, posTables, tableBrowserOpen]);\n\n'''
s = replace_once(s, effect_anchor, effect_new, "same page table listener")

helper = '''  function buildFg0003DineInReductionJob(nextCart: CartItem[], cashierMutationVersion: number): DineInAutoSendJob | null {\n    if (!fg0003QrKitchenHardeningActive || orderType !== "dine_in" || !isOnline) return null;\n    const table = selectedTableRef.current;\n    if (!table?.id || !table.active_session_id || !shift?.id || shift.status !== "open") return null;\n    const committed = committedDineInCartByTableIdRef.current[table.id] ?? [];\n    if (committed.length === 0) return null;\n\n    const nextQtyByKey = new Map<string, number>();\n    for (const item of nextCart) {\n      const key = buildCartMergeKey(item);\n      nextQtyByKey.set(key, (nextQtyByKey.get(key) ?? 0) + Math.max(0, Number(item.quantity ?? 0)));\n    }\n\n    const committedByKey = new Map<string, CartItem>();\n    for (const item of committed) {\n      const key = buildCartMergeKey(item);\n      const existing = committedByKey.get(key);\n      if (existing) {\n        existing.quantity += Math.max(0, Number(item.quantity ?? 0));\n      } else {\n        committedByKey.set(key, { ...item, quantity: Math.max(0, Number(item.quantity ?? 0)) });\n      }\n    }\n\n    let hasReduction = false;\n    const serverDesiredCart: CartItem[] = [];\n    for (const [key, item] of committedByKey) {\n      const committedQty = Math.max(0, Number(item.quantity ?? 0));\n      const nextQty = Math.max(0, Number(nextQtyByKey.get(key) ?? 0));\n      const targetQty = Math.min(committedQty, nextQty);\n      if (targetQty < committedQty) hasReduction = true;\n      if (targetQty > 0) serverDesiredCart.push({ ...item, quantity: targetQty });\n    }\n    if (!hasReduction) return null;\n\n    const reducedSubtotal = Number(serverDesiredCart.reduce((sum, item) => sum + item.quantity * item.price, 0).toFixed(2));\n    let reducedDiscount = 0;\n    if (discountEditMode === "amount") {\n      const amount = Number(discountAmountInput);\n      if (Number.isFinite(amount) && amount > 0) reducedDiscount = Math.min(reducedSubtotal, amount);\n    } else {\n      const percent = Number(discountPercentInput);\n      if (Number.isFinite(percent) && percent > 0) {\n        reducedDiscount = reducedSubtotal * (Math.min(100, Math.max(0, percent)) / 100);\n      } else if (subtotal > 0 && summaryDiscount > 0) {\n        reducedDiscount = reducedSubtotal * Math.min(1, summaryDiscount / subtotal);\n      }\n    }\n    reducedDiscount = Number(Math.min(reducedSubtotal, Math.max(0, reducedDiscount)).toFixed(2));\n\n    return {\n      table: { id: table.id, table_code: table.table_code, active_session_id: table.active_session_id },\n      activeOrder: activeOrder?.status === "queued" ? activeOrder : null,\n      shiftId: shift.id,\n      cart: serverDesiredCart,\n      localDraftCart: nextCart.map((item) => ({ ...item })),\n      signature: buildCartSignature(serverDesiredCart),\n      cashierMutationVersion,\n      subtotal: reducedSubtotal,\n      summaryDiscount: reducedDiscount,\n      taxBaseTotal: Math.max(0, Number((reducedSubtotal - reducedDiscount).toFixed(2))),\n      taxSettings,\n      member: selectedMember\n        ? {\n            name: selectedMember.name,\n            phone: selectedMember.phone,\n            code: selectedMember.member_token ?? selectedMember.id,\n            points: selectedMember.points,\n            stamps: selectedMember.stamps\n          }\n        : null\n    };\n  }\n\n  function syncFg0003DineInReduction(nextCart: CartItem[], cashierMutationVersion: number) {\n    if (!fg0003QrKitchenHardeningActive || orderType !== "dine_in") return;\n    const tableId = selectedTableRef.current?.id ?? null;\n    if (tableId) rememberDineInDraft(tableId, nextCart);\n    const job = buildFg0003DineInReductionJob(nextCart, cashierMutationVersion);\n    if (!job) return;\n    void autoSendDineInKitchenOrder(job).catch((error) => {\n      pushSubmitMessage(localizeApiMessage(error instanceof Error ? error.message : "DINE_IN_CANCEL_SYNC_FAILED"));\n    });\n  }\n\n'''
s = replace_once(s, "  function removeFromCart(cartLineId: string) {\n", helper + "  function removeFromCart(cartLineId: string) {\n", "reduction helper insertion")
s = replace_once(
    s,
    '''  function removeFromCart(cartLineId: string) {\n    markDineInCashierCartMutation();\n    setCart((current) => current.filter((row) => (row.cart_line_id ?? row.product_id) !== cartLineId));\n  }\n''',
    '''  function removeFromCart(cartLineId: string) {\n    const nextCart = cartRef.current.filter((row) => (row.cart_line_id ?? row.product_id) !== cartLineId);\n    const mutationVersion = markDineInCashierCartMutation();\n    setCart(nextCart);\n    syncFg0003DineInReduction(nextCart, mutationVersion);\n  }\n''',
    "remove cart reduction sync",
)
old_adjust_tail = '''    markDineInCashierCartMutation();\n    setCart((current) =>\n      current\n        .map((row) =>\n          (row.cart_line_id ?? row.product_id) === cartLineId ? { ...row, quantity: Math.max(0, row.quantity + delta) } : row\n        )\n        .filter((row) => row.quantity > 0)\n    );\n  }\n'''
new_adjust_tail = '''    const nextCart = cartRef.current\n      .map((row) =>\n        (row.cart_line_id ?? row.product_id) === cartLineId ? { ...row, quantity: Math.max(0, row.quantity + delta) } : row\n      )\n      .filter((row) => row.quantity > 0);\n    const mutationVersion = markDineInCashierCartMutation();\n    setCart(nextCart);\n    syncFg0003DineInReduction(nextCart, mutationVersion);\n  }\n'''
s = replace_once(s, old_adjust_tail, new_adjust_tail, "adjust qty reduction sync")
old_set_qty = '''    markDineInCashierCartMutation();\n    setCart((current) =>\n      current.map((row) =>\n        (row.cart_line_id ?? row.product_id) === cartLineId ? { ...row, quantity: nextQuantity } : row\n      )\n    );\n    return true;\n'''
new_set_qty = '''    const nextCart = cartRef.current.map((row) =>\n      (row.cart_line_id ?? row.product_id) === cartLineId ? { ...row, quantity: nextQuantity } : row\n    );\n    const mutationVersion = markDineInCashierCartMutation();\n    setCart(nextCart);\n    syncFg0003DineInReduction(nextCart, mutationVersion);\n    return true;\n'''
s = replace_once(s, old_set_qty, new_set_qty, "set qty reduction sync")
s = replace_once(
    s,
    '''    if (cartRef.current.length > 0) markDineInCashierCartMutation();\n    setCart([]);\n    setSelectedMember(null);\n''',
    '''    const mutationVersion = cartRef.current.length > 0 ? markDineInCashierCartMutation() : 0;\n    setCart([]);\n    syncFg0003DineInReduction([], mutationVersion);\n    setSelectedMember(null);\n''',
    "clear cart reduction sync",
)
s = replace_once(
    s,
    "        rememberDineInDraft(tableId, []);\n        commitDineInCashierMutation(tableId, job.cashierMutationVersion);\n",
    "        rememberDineInDraft(tableId, job.localDraftCart ?? []);\n        commitDineInCashierMutation(tableId, job.cashierMutationVersion);\n",
    "clear sync local draft preservation",
)
s = replace_once(
    s,
    "        rememberDineInDraft(tableId, job.cart);\n        commitDineInCashierMutation(tableId, job.cashierMutationVersion);\n",
    "        rememberDineInDraft(tableId, job.localDraftCart ?? job.cart);\n        commitDineInCashierMutation(tableId, job.cashierMutationVersion);\n",
    "normal sync local draft preservation",
)
write(path, s)

# Automatic paid receipt: label cancelled rows and restore cancelled quantity for display.
path = "apps/backoffice-web/src/app/api/pos/payments/route.ts"
s = read(path)
s = replace_once(
    s,
    '.select("quantity,unit_price,line_total,notes,products(name)")',
    '.select("quantity,unit_price,line_total,notes,metadata,products(name)")',
    "payment receipt metadata select",
)
old_items = '              items: (itemRows ?? []).map((row) => ({ product_name: ((row.products as { name?: string } | null)?.name ?? "Item").toString(), quantity: Number(row.quantity), unit_price: Number(row.unit_price), line_total: Number(row.line_total), note: row.notes })),\n'
new_items = '''              items: (itemRows ?? []).map((row) => {\n                const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};\n                const cancelled = String(metadata.bill_line_state ?? "").toLowerCase() === "cancelled";\n                const productName = ((row.products as { name?: string } | null)?.name ?? "Item").toString();\n                const cancelledQuantity = Math.max(0, Number(metadata.cancelled_quantity ?? 0));\n                const noteParts = [row.notes ? String(row.notes) : "", cancelled ? "ยกเลิก / CANCELLED" : ""].filter(Boolean);\n                return {\n                  product_name: cancelled ? `[ยกเลิก] ${productName}` : productName,\n                  quantity: cancelled ? cancelledQuantity : Number(row.quantity),\n                  unit_price: Number(row.unit_price),\n                  line_total: cancelled ? 0 : Number(row.line_total),\n                  note: noteParts.length > 0 ? noteParts.join(" • ") : null\n                };\n              }),\n'''
s = replace_once(s, old_items, new_items, "payment receipt cancelled mapping")
write(path, s)

# Reprint: use same authoritative cancelled line presentation.
path = "apps/backoffice-web/src/lib/printing/routed-print-service.ts"
s = read(path)
s = replace_once(
    s,
    '.select("product_id,name,quantity,unit_price,line_total,notes")',
    '.select("product_id,name,quantity,unit_price,line_total,notes,metadata")',
    "reprint metadata select",
)
old_reprint_items = '''  const receiptItems = (itemsResult.data ?? []).map((item) => ({\n    name: String(item.name ?? item.product_id ?? "Item"),\n    qty: Number(item.quantity ?? 0),\n    unit_price: Number(item.unit_price ?? 0),\n    line_total: Number(item.line_total ?? 0),\n    note: item.notes ? String(item.notes) : null\n  }));\n'''
new_reprint_items = '''  const receiptItems = (itemsResult.data ?? []).map((item) => {\n    const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {};\n    const cancelled = String(metadata.bill_line_state ?? "").toLowerCase() === "cancelled";\n    const name = String(item.name ?? item.product_id ?? "Item");\n    const cancelledQuantity = Math.max(0, Number(metadata.cancelled_quantity ?? 0));\n    const noteParts = [item.notes ? String(item.notes) : "", cancelled ? "ยกเลิก / CANCELLED" : ""].filter(Boolean);\n    return {\n      name: cancelled ? `[ยกเลิก] ${name}` : name,\n      qty: cancelled ? cancelledQuantity : Number(item.quantity ?? 0),\n      unit_price: Number(item.unit_price ?? 0),\n      line_total: cancelled ? 0 : Number(item.line_total ?? 0),\n      note: noteParts.length > 0 ? noteParts.join(" • ") : null,\n      cancelled\n    };\n  });\n  const hasCancelledReceiptItems = receiptItems.some((item) => item.cancelled);\n'''
s = replace_once(s, old_reprint_items, new_reprint_items, "reprint cancelled mapping")
s = replace_once(
    s,
    "        payload_html: args.receiptHtml?.trim() || fallbackHtml\n",
    "        payload_html: hasCancelledReceiptItems ? fallbackHtml : args.receiptHtml?.trim() || fallbackHtml\n",
    "reprint authoritative cancelled html",
)
write(path, s)

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


# 1) Public QR route: durable customer-action timeline without changing business transaction semantics.
path = "apps/backoffice-web/src/app/api/table-order/[token]/route.ts"
s = read(path)
s = replace_once(
    s,
    'import { assertTableQrStockAvailable, loadTableQrStockStates } from "@/lib/table-qr-stock";\n',
    'import { assertTableQrStockAvailable, loadTableQrStockStates } from "@/lib/table-qr-stock";\nimport { recordTableQrTimelineEvent } from "@/lib/table-qr-timeline";\n',
    "table order timeline import",
)
s = replace_once(
    s,
    '''      const qrContext = await resolveTableQrContext(token);\n      if (wantsStatus) return loadTableQrState(qrContext);\n''',
    '''      const qrContext = await resolveTableQrContext(token);\n      if (wantsStatus) return loadTableQrState(qrContext);\n      await recordTableQrTimelineEvent({\n        request,\n        context: qrContext,\n        eventType: "qr_opened",\n        severity: "green",\n        success: true,\n        statusCode: 200,\n        durationMs: Date.now() - startedAt,\n        payload: { source: "menu_open" }\n      });\n''',
    "qr opened timeline",
)
s = replace_once(
    s,
    '''export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {\n  let token = "";\n  let action = "order";\n  let requestId = "";\n  let itemCount = 0;\n  try {\n''',
    '''export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {\n  let token = "";\n  let action = "order";\n  let requestId = "";\n  let itemCount = 0;\n  let timelineContext: Awaited<ReturnType<typeof resolveTableQrContext>> | null = null;\n  let timelineItems: ReturnType<typeof normalizeItems> = [];\n  const startedAt = Date.now();\n  try {\n''',
    "table order post timeline state",
)
s = replace_once(
    s,
    '''    const items = normalizeItems(body);\n    itemCount = items.length;\n    if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) return fail("invalid_items", "จำนวนอาหารไม่ถูกต้อง", 422);\n\n    const qrContext = await resolveTableQrContext(token);\n    await assertTableQrBuffetItemsAllowed({ context: qrContext, items });\n    await assertTableQrStockAvailable({ tenantId: qrContext.tenant_id, branchId: qrContext.branch_id, items });\n    const result = await submitTableQrOrder({ context: qrContext, requestId, items, note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null, clientId });\n    return ok({ submission_id: result.submission_id, order_no: result.order_no, table_code: qrContext.table_code, subtotal: Number(result.subtotal), tax_total: Number(result.tax_total), grand_total: Number(result.grand_total), duplicate_request: result.duplicate_request, review_status: result.review_status ?? null, kitchen_pending_review: result.kitchen_pending_review === true }, result.duplicate_request ? 200 : 201);\n  } catch (error) {\n    return publicError(error, { method: "POST", token, action, requestId, itemCount });\n  }\n}\n''',
    '''    const items = normalizeItems(body);\n    timelineItems = items;\n    itemCount = items.length;\n    if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) return fail("invalid_items", "จำนวนอาหารไม่ถูกต้อง", 422);\n\n    const qrContext = await resolveTableQrContext(token);\n    timelineContext = qrContext;\n    await recordTableQrTimelineEvent({\n      request,\n      context: qrContext,\n      eventType: "submit_attempt",\n      severity: "yellow",\n      requestId,\n      itemCount,\n      success: null,\n      payload: {\n        items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, note: item.note ?? null, selected_ingredient_ids: item.selected_ingredient_ids ?? [] })),\n        note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null,\n        source: "customer_press_order"\n      }\n    });\n    await assertTableQrBuffetItemsAllowed({ context: qrContext, items });\n    await assertTableQrStockAvailable({ tenantId: qrContext.tenant_id, branchId: qrContext.branch_id, items });\n    const result = await submitTableQrOrder({ context: qrContext, requestId, items, note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null, clientId });\n    await recordTableQrTimelineEvent({\n      request,\n      context: qrContext,\n      eventType: result.duplicate_request ? "duplicate_blocked" : "submit_success",\n      severity: result.duplicate_request ? "yellow" : "green",\n      requestId,\n      submissionId: result.submission_id,\n      orderId: result.order_id ?? null,\n      itemCount,\n      amount: Number(result.grand_total),\n      success: true,\n      statusCode: result.duplicate_request ? 200 : 201,\n      durationMs: Date.now() - startedAt,\n      payload: {\n        items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, note: item.note ?? null, selected_ingredient_ids: item.selected_ingredient_ids ?? [] })),\n        duplicate_request: result.duplicate_request,\n        review_status: result.review_status ?? null,\n        kitchen_pending_review: result.kitchen_pending_review === true\n      }\n    });\n    return ok({ submission_id: result.submission_id, order_no: result.order_no, table_code: qrContext.table_code, subtotal: Number(result.subtotal), tax_total: Number(result.tax_total), grand_total: Number(result.grand_total), duplicate_request: result.duplicate_request, review_status: result.review_status ?? null, kitchen_pending_review: result.kitchen_pending_review === true }, result.duplicate_request ? 200 : 201);\n  } catch (error) {\n    const response = publicError(error, { method: "POST", token, action, requestId, itemCount });\n    if (action === "order" && timelineContext && requestId) {\n      await recordTableQrTimelineEvent({\n        request,\n        context: timelineContext,\n        eventType: "submit_failure",\n        severity: "red",\n        requestId,\n        itemCount,\n        success: false,\n        statusCode: response.status,\n        errorCode: getErrorMessage(error).slice(0, 160),\n        durationMs: Date.now() - startedAt,\n        payload: {\n          items: timelineItems.map((item) => ({ product_id: item.product_id, quantity: item.quantity, note: item.note ?? null, selected_ingredient_ids: item.selected_ingredient_ids ?? [] })),\n          message: getErrorMessage(error).slice(0, 500)\n        }\n      });\n    }\n    return response;\n  }\n}\n''',
    "table order submit timeline",
)
write(path, s)


# 2) QR mobile: reduce steady-state DB/API pressure. Submit still performs immediate authoritative refresh.
path = "apps/backoffice-web/src/components/table-order/table-order-mobile.tsx"
s = read(path)
s = replace_once(s, "const MENU_STATUS_POLL_MS = 3_000;\n", "const MENU_STATUS_POLL_MS = 12_000;\n", "mobile status poll interval")
write(path, s)


# 3) POS cart cancellation: debounce rapid reductions and stop 8-second bill refresh from competing with the mutation.
# This file has already been transformed by apply_fg0003_cart_cancel_receipt.py earlier in prebuild.
path = "apps/backoffice-web/src/components/pos/pos-sales-module.tsx"
s = read(path)
s = replace_once(
    s,
    '''    void autoSendDineInKitchenOrder(job).catch((error) => {\n      pushSubmitMessage(localizeApiMessage(error instanceof Error ? error.message : "DINE_IN_CANCEL_SYNC_FAILED"));\n    });\n''',
    '''    // Collapse rapid minus/delete taps into the latest desired cart before touching the server.\n    // scheduleDineInKitchenAutoSend already serializes per table and replaces a pending timer/job.\n    scheduleDineInKitchenAutoSend(job, 450);\n''',
    "fg0003 cancellation debounce",
)
s = replace_once(
    s,
    '''      const table = selectedTableRef.current;\n      if (!table?.id || table.id !== selectedTable.id) return;\n      activeTableBillRefreshInFlightRef.current = true;\n''',
    '''      const table = selectedTableRef.current;\n      if (!table?.id || table.id !== selectedTable.id) return;\n      if (fg0003QrKitchenHardeningActive && (dineInAutoSendJobsRef.current.has(table.id) || dineInAutoSendInFlightRef.current.has(table.id))) return;\n      activeTableBillRefreshInFlightRef.current = true;\n''',
    "fg0003 skip bill refresh during cancellation",
)
write(path, s)

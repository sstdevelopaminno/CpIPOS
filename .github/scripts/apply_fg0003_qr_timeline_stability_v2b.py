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


path = "apps/backoffice-web/src/app/api/table-order/[token]/route.ts"
s = read(path)
s = replace_once(s,
    'import { assertTableQrStockAvailable, loadTableQrStockStates } from "@/lib/table-qr-stock";\n',
    'import { assertTableQrStockAvailable, loadTableQrStockStates } from "@/lib/table-qr-stock";\nimport { recordTableQrTimelineEvent } from "@/lib/table-qr-timeline";\n',
    "timeline import")
s = replace_once(s,
    '      const qrContext = await resolveTableQrContext(token);\n      if (wantsStatus) return loadTableQrState(qrContext);\n',
    '''      const qrContext = await resolveTableQrContext(token);\n      if (wantsStatus) return loadTableQrState(qrContext);\n      await recordTableQrTimelineEvent({\n        request, context: qrContext, eventType: "qr_opened", severity: "green",\n        success: true, statusCode: 200, durationMs: Date.now() - startedAt, payload: { source: "menu_open" }\n      });\n''',
    "qr open timeline")
s = replace_once(s,
    '''export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {\n  let token = "";\n  let action = "order";\n  let requestId = "";\n  let itemCount = 0;\n  try {\n''',
    '''export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {\n  let token = "";\n  let action = "order";\n  let requestId = "";\n  let itemCount = 0;\n  let timelineContext: Awaited<ReturnType<typeof resolveTableQrContext>> | null = null;\n  let timelineItems: ReturnType<typeof normalizeItems> = [];\n  const startedAt = Date.now();\n  try {\n''',
    "post timeline state")
old = '''    const items = normalizeItems(body);\n    itemCount = items.length;\n    if (items.length < 1 || items.length > 50) return fail("invalid_items", "กรุณาเลือกเมนู 1-50 รายการ", 422);\n    if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) return fail("invalid_items", "จำนวนอาหารไม่ถูกต้อง", 422);\n\n    const qrContext = await resolveTableQrContext(token);\n    await assertTableQrBuffetItemsAllowed({ context: qrContext, items });\n    await assertTableQrStockAvailable({ tenantId: qrContext.tenant_id, branchId: qrContext.branch_id, items });\n    const result = await submitTableQrOrder({ context: qrContext, requestId, items, note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null, clientId });\n    return ok({ submission_id: result.submission_id, order_no: result.order_no, table_code: qrContext.table_code, subtotal: Number(result.subtotal), tax_total: Number(result.tax_total), grand_total: Number(result.grand_total), duplicate_request: result.duplicate_request, review_status: result.review_status ?? null, kitchen_pending_review: result.kitchen_pending_review === true }, result.duplicate_request ? 200 : 201);\n  } catch (error) {\n    return publicError(error, { method: "POST", token, action, requestId, itemCount });\n  }\n}\n'''
new = '''    const items = normalizeItems(body);\n    timelineItems = items;\n    itemCount = items.length;\n    if (items.length < 1 || items.length > 50) return fail("invalid_items", "กรุณาเลือกเมนู 1-50 รายการ", 422);\n    if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) return fail("invalid_items", "จำนวนอาหารไม่ถูกต้อง", 422);\n\n    const qrContext = await resolveTableQrContext(token);\n    timelineContext = qrContext;\n    await recordTableQrTimelineEvent({\n      request, context: qrContext, eventType: "submit_attempt", severity: "yellow", requestId, itemCount, success: null,\n      payload: {\n        items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, note: item.note ?? null, selected_ingredient_ids: item.selected_ingredient_ids ?? [] })),\n        note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null, source: "customer_press_order"\n      }\n    });\n    await assertTableQrBuffetItemsAllowed({ context: qrContext, items });\n    await assertTableQrStockAvailable({ tenantId: qrContext.tenant_id, branchId: qrContext.branch_id, items });\n    const result = await submitTableQrOrder({ context: qrContext, requestId, items, note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null, clientId });\n    await recordTableQrTimelineEvent({\n      request, context: qrContext, eventType: result.duplicate_request ? "duplicate_blocked" : "submit_success",\n      severity: result.duplicate_request ? "yellow" : "green", requestId, submissionId: result.submission_id,\n      orderId: result.order_id ?? null, itemCount, amount: Number(result.grand_total), success: true,\n      statusCode: result.duplicate_request ? 200 : 201, durationMs: Date.now() - startedAt,\n      payload: {\n        items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, note: item.note ?? null, selected_ingredient_ids: item.selected_ingredient_ids ?? [] })),\n        duplicate_request: result.duplicate_request, review_status: result.review_status ?? null, kitchen_pending_review: result.kitchen_pending_review === true\n      }\n    });\n    return ok({ submission_id: result.submission_id, order_no: result.order_no, table_code: qrContext.table_code, subtotal: Number(result.subtotal), tax_total: Number(result.tax_total), grand_total: Number(result.grand_total), duplicate_request: result.duplicate_request, review_status: result.review_status ?? null, kitchen_pending_review: result.kitchen_pending_review === true }, result.duplicate_request ? 200 : 201);\n  } catch (error) {\n    const response = publicError(error, { method: "POST", token, action, requestId, itemCount });\n    if (action === "order" && timelineContext && requestId) {\n      await recordTableQrTimelineEvent({\n        request, context: timelineContext, eventType: "submit_failure", severity: "red", requestId, itemCount, success: false,\n        statusCode: response.status, errorCode: getErrorMessage(error).slice(0, 160), durationMs: Date.now() - startedAt,\n        payload: {\n          items: timelineItems.map((item) => ({ product_id: item.product_id, quantity: item.quantity, note: item.note ?? null, selected_ingredient_ids: item.selected_ingredient_ids ?? [] })),\n          message: getErrorMessage(error).slice(0, 500)\n        }\n      });\n    }\n    return response;\n  }\n}\n'''
s = replace_once(s, old, new, "submit timeline block")
write(path, s)

path = "apps/backoffice-web/src/components/table-order/table-order-mobile.tsx"
s = read(path)
s = replace_once(s, "const MENU_STATUS_POLL_MS = 3_000;\n", "const MENU_STATUS_POLL_MS = 12_000;\n", "status polling")
write(path, s)

# Existing prebuild patch has already installed FG0003 reduction-only sync in this source.
path = "apps/backoffice-web/src/components/pos/pos-sales-module.tsx"
s = read(path)
s = replace_once(s,
    '''    void autoSendDineInKitchenOrder(job).catch((error) => {\n      pushSubmitMessage(localizeApiMessage(error instanceof Error ? error.message : "DINE_IN_CANCEL_SYNC_FAILED"));\n    });\n''',
    '''    // Debounce rapid minus/delete taps into the latest desired server cart.\n    scheduleDineInKitchenAutoSend(job, 450);\n''',
    "cancel debounce")
s = replace_once(s,
    '''      const table = selectedTableRef.current;\n      if (!table?.id || table.id !== selectedTable.id) return;\n      activeTableBillRefreshInFlightRef.current = true;\n''',
    '''      const table = selectedTableRef.current;\n      if (!table?.id || table.id !== selectedTable.id) return;\n      if (fg0003QrKitchenHardeningActive && (dineInAutoSendJobsRef.current.has(table.id) || dineInAutoSendInFlightRef.current.has(table.id))) return;\n      activeTableBillRefreshInFlightRef.current = true;\n''',
    "skip bill poll during cancel")
write(path, s)

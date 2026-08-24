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


# 0) Timeline audit: correlate the original customer request to a later POS review/order id,
# and make duplicate-print fallback detection local to each ticket+printer group.
path = "apps/backoffice-web/src/app/api/pos/table-qr-timeline/route.ts"
s = read(path)
s = replace_once(
    s,
    '''    const terminalResult = requestIds.length > 0\n      ? await supabase\n          .from("table_qr_timeline_events")\n          .select(EVENT_SELECT)\n          .eq("tenant_id", auth.tenantId!)\n          .eq("branch_id", auth.branchId!)\n          .in("request_id", requestIds)\n          .in("event_type", TERMINAL_EVENT_TYPES)\n          .order("event_at", { ascending: false })\n          .limit(Math.min(600, requestIds.length * 3))\n      : { data: [], error: null };\n''',
    '''    const terminalResult = requestIds.length > 0\n      ? await supabase\n          .from("table_qr_timeline_events")\n          .select(EVENT_SELECT)\n          .eq("tenant_id", auth.tenantId!)\n          .eq("branch_id", auth.branchId!)\n          .in("request_id", requestIds)\n          .order("event_at", { ascending: false })\n          .limit(Math.min(1200, requestIds.length * 8))\n      : { data: [], error: null };\n''',
    "timeline request correlation query",
)
s = replace_once(
    s,
    '''    const terminalRows = (terminalResult.data ?? []) as unknown as TimelineRow[];\n    const terminalByRequest = new Map<string, TimelineRow>();\n    for (const row of terminalRows) {\n      if (row.request_id && !terminalByRequest.has(row.request_id)) terminalByRequest.set(row.request_id, row);\n    }\n\n    const relatedOrderIdByEvent = new Map<string, string | null>();\n    for (const row of rows) {\n      const terminal = row.request_id ? terminalByRequest.get(row.request_id) : null;\n      relatedOrderIdByEvent.set(row.id, row.order_id ?? terminal?.order_id ?? null);\n    }\n''',
    '''    const terminalRows = (terminalResult.data ?? []) as unknown as TimelineRow[];\n    const terminalByRequest = new Map<string, TimelineRow>();\n    const relatedOrderByRequest = new Map<string, string>();\n    for (const row of terminalRows) {\n      if (row.request_id && row.order_id && !relatedOrderByRequest.has(row.request_id)) {\n        relatedOrderByRequest.set(row.request_id, row.order_id);\n      }\n      if (row.request_id && TERMINAL_EVENT_TYPES.includes(row.event_type) && !terminalByRequest.has(row.request_id)) {\n        terminalByRequest.set(row.request_id, row);\n      }\n    }\n\n    const relatedOrderIdByEvent = new Map<string, string | null>();\n    for (const row of rows) {\n      const terminal = row.request_id ? terminalByRequest.get(row.request_id) : null;\n      const relatedOrder = row.request_id ? relatedOrderByRequest.get(row.request_id) ?? null : null;\n      relatedOrderIdByEvent.set(row.id, row.order_id ?? relatedOrder ?? terminal?.order_id ?? null);\n    }\n''',
    "timeline request order correlation",
)
s = replace_once(
    s,
    '''    for (const printerJobs of byPrinter.values()) {\n      const normalJobs = printerJobs.filter((job) => String(asRecord(job.metadata).request_source ?? "") !== "kitchen_ticket_reprint");\n''',
    '''    for (const printerJobs of byPrinter.values()) {\n      const duplicateCountBeforeGroup = duplicateJobIds.size;\n      const normalJobs = printerJobs.filter((job) => String(asRecord(job.metadata).request_source ?? "") !== "kitchen_ticket_reprint");\n''',
    "timeline print duplicate group marker",
)
s = replace_once(
    s,
    '      if (normalJobs.length > expectedCopies && duplicateJobIds.size === 0) {\n',
    '      if (normalJobs.length > expectedCopies && duplicateJobIds.size === duplicateCountBeforeGroup) {\n',
    "timeline print duplicate group fallback",
)
write(path, s)


# 1) POS Dine-in / Takeaway: explicit kitchen confirmation before the first/new cart mutation is submitted.
path = "apps/backoffice-web/src/components/pos/pos-sales-module.tsx"
s = read(path)
s = replace_once(
    s,
    'import { PosHeldBillsModal } from "@/components/pos/pos-held-bills-modal";\n',
    'import { PosHeldBillsModal } from "@/components/pos/pos-held-bills-modal";\nimport { PosKitchenOrderConfirmModal } from "@/components/pos/pos-kitchen-order-confirm-modal";\n',
    "pos kitchen confirm import",
)
s = replace_once(
    s,
    '  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);\n  const [billPaymentMethod, setBillPaymentMethod] = useState<BillPaymentMethod>(null);\n',
    '  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);\n  const [kitchenOrderConfirmOpen, setKitchenOrderConfirmOpen] = useState(false);\n  const [billPaymentMethod, setBillPaymentMethod] = useState<BillPaymentMethod>(null);\n',
    "pos kitchen confirm state",
)
handle_anchor = '''  async function handleCheckout() {\n'''
handle_wrapper = '''  function needsKitchenOrderConfirmation() {\n    if (!fg0003QrKitchenHardeningActive) return false;\n    if (orderType !== "dine_in" && orderType !== "takeaway") return false;\n    if (cartRef.current.length === 0) return false;\n    return buildCartSignature(cartRef.current) !== lastCommittedCartSignature;\n  }\n\n  function requestCheckoutWithKitchenConfirmation() {\n    if (isBusy || checkoutRequestLockRef.current) return;\n    if (needsKitchenOrderConfirmation()) {\n      setKitchenOrderConfirmOpen(true);\n      return;\n    }\n    void handleCheckout();\n  }\n\n  function confirmKitchenOrderAndCheckout() {\n    if (isBusy || checkoutRequestLockRef.current) return;\n    setKitchenOrderConfirmOpen(false);\n    void handleCheckout();\n  }\n\n'''
s = replace_once(s, handle_anchor, handle_wrapper + handle_anchor, "pos kitchen confirm checkout wrapper")
s = replace_once(
    s,
    '''        if (orderType === "dine_in" && selectedTable?.id) {\n          rememberDineInDraft(selectedTable.id, cartSnapshot);\n          setLastCommittedCartSignature(cartSnapshotSignature);\n        }\n        setTakeawayCreatingPreview(null);\n''',
    '''        if (orderType === "dine_in" && selectedTable?.id) {\n          rememberDineInDraft(selectedTable.id, cartSnapshot);\n        }\n        // Both dine-in and takeaway have now passed the explicit kitchen confirmation\n        // and the authoritative submit. Keep the signature so payment does not ask twice.\n        setLastCommittedCartSignature(cartSnapshotSignature);\n        setTakeawayCreatingPreview(null);\n''',
    "pos committed cart signature after kitchen confirmation",
)
s = replace_once(
    s,
    '          onCheckout={handleCheckout}\n',
    '          onCheckout={requestCheckoutWithKitchenConfirmation}\n',
    "pos checkout confirm handler",
)
s = replace_once(
    s,
    '      <PosPaymentModals\n',
    '''      <PosKitchenOrderConfirmModal\n        open={kitchenOrderConfirmOpen}\n        lang={lang}\n        orderType={orderType}\n        tableCode={selectedTable?.table_code ?? null}\n        items={cart}\n        total={total}\n        busy={isBusy}\n        onCancel={() => setKitchenOrderConfirmOpen(false)}\n        onConfirm={confirmKitchenOrderAndCheckout}\n      />\n      <PosPaymentModals\n''',
    "pos kitchen confirm modal render",
)
write(path, s)


# 2) Print enqueue: DB unique key is authoritative. Concurrent duplicate inserts become idempotent reads.
path = "apps/backoffice-web/src/lib/printing/print-service.ts"
s = read(path)
old_error = '''  if (error) {\n    throw new Error(error.message);\n  }\n\n  return data as PrintJobRow;\n}\n\nasync function updatePrintJobStatus(\n'''
new_error = '''  if (error) {\n    const errorCode = String((error as { code?: string | null }).code ?? "");\n    if (errorCode === "23505" && input.idempotencyKey) {\n      const { data: existing, error: existingError } = await supabase\n        .from("print_jobs")\n        .select(\n          "id,tenant_id,branch_id,order_id,kitchen_ticket_id,idempotency_key,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,printed_at,failed_at,created_at,updated_at,metadata"\n        )\n        .eq("tenant_id", input.auth.tenantId!)\n        .eq("branch_id", input.auth.branchId!)\n        .eq("idempotency_key", input.idempotencyKey)\n        .maybeSingle();\n      if (!existingError && existing) return existing as PrintJobRow;\n    }\n    throw new Error(error.message);\n  }\n\n  return data as PrintJobRow;\n}\n\nasync function updatePrintJobStatus(\n'''
s = replace_once(s, old_error, new_error, "print enqueue unique race recovery")

# Claim direct/server printing atomically. A second caller seeing the same pending job cannot print it again.
old_claim = '''export async function processPrintJob(jobId: string): Promise<PrintJobRow | null> {\n  const job = await getPrintJobWithPrinter(jobId);\n  if (!job) {\n    return null;\n  }\n\n  const printer = job.printer_profiles;\n'''
new_claim = '''export async function processPrintJob(jobId: string): Promise<PrintJobRow | null> {\n  const job = await getPrintJobWithPrinter(jobId);\n  if (!job) {\n    return null;\n  }\n  if (job.status === "printed" || job.status === "printing") return job;\n\n  const supabase = getSupabaseServiceClient();\n  const { data: claimed, error: claimError } = await supabase\n    .from("print_jobs")\n    .update({ status: "printing", updated_at: nowIso() })\n    .eq("id", jobId)\n    .eq("tenant_id", job.tenant_id)\n    .eq("branch_id", job.branch_id)\n    .in("status", ["pending", "retrying"])\n    .select("id")\n    .maybeSingle();\n  if (claimError) throw new Error(claimError.message);\n  if (!claimed) {\n    const current = await getPrintJobWithPrinter(jobId);\n    return current as PrintJobRow | null;\n  }\n\n  const printer = job.printer_profiles;\n'''
s = replace_once(s, old_claim, new_claim, "direct print atomic claim")
write(path, s)


# 3) Route copy-specific idempotency. Intentional configured copies get stable separate keys.
path = "apps/backoffice-web/src/lib/printing/routed-print-service.ts"
s = read(path)
s = replace_once(
    s,
    '      idempotencyKey: args.idempotencyKey ?? null,\n',
    '      idempotencyKey: args.idempotencyKey ? `${args.idempotencyKey}:copy:${copy}` : null,\n',
    "print per-copy idempotency key",
)
s = replace_once(
    s,
    '''        copy_number: copy,\n        copy_count: args.route.copies\n''',
    '''        copy_number: copy,\n        copy_count: args.route.copies,\n        duplicate_guard_version: "print_v3"\n''',
    "print duplicate guard metadata",
)
write(path, s)

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

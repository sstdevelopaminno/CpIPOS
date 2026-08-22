from pathlib import Path


def replace_once_or_verify(path: Path, old: str, new: str):
    text = path.read_text(encoding="utf-8")
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1:
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
        return
    if old_count == 0 and new_count >= 1:
        return
    raise SystemExit(f"{path}: expected one old match or existing patched form; old={old_count}, new={new_count}")


qr = Path("apps/backoffice-web/src/lib/table-qr-ordering.ts")
replace_once_or_verify(
    qr,
    '    .from("table_qr_orders")\n    .select("id,order_id,payload,created_at")\n    .eq("qr_session_id", args.context.id)',
    '    .from("table_qr_orders")\n    .select("id,order_id,payload,created_at")\n    .eq("tenant_id", args.context.tenant_id)\n    .eq("branch_id", args.context.branch_id)\n    .eq("qr_session_id", args.context.id)',
)

old_mark = '''async function markQrOrderPayloadFingerprint(args: {
  context: QrContext;
  submissionId: string;
  clientId: string;
  payloadFingerprint: string;
  supabase: ReturnType<typeof getSupabaseServiceClient>;
}) {
  if (args.clientId === "anonymous") return;
  const { data, error: loadError } = await args.supabase
    .from("table_qr_orders")
    .select("payload")
    .eq("id", args.submissionId)
    .eq("qr_session_id", args.context.id)
    .maybeSingle<{ payload: Record<string, unknown> | null }>();
  if (loadError) {
    console.warn("[table-qr-ordering] duplicate fingerprint payload load failed", { submissionId: args.submissionId, message: loadError.message });
    return;
  }
  const payload = data?.payload && typeof data.payload === "object" ? data.payload : {};
  const { error: updateError } = await args.supabase
    .from("table_qr_orders")
    .update({
      payload: {
        ...payload,
        client_id: args.clientId,
        payload_fingerprint: args.payloadFingerprint,
        payload_fingerprint_version: 1
      }
    })
    .eq("id", args.submissionId)
    .eq("qr_session_id", args.context.id);
  if (updateError) {
    console.warn("[table-qr-ordering] duplicate fingerprint payload update failed", { submissionId: args.submissionId, message: updateError.message });
  }
}'''
new_mark = '''async function markQrOrderPayloadFingerprint(args: {
  context: QrContext;
  submissionId: string;
  clientId: string;
  payloadFingerprint: string;
  supabase: ReturnType<typeof getSupabaseServiceClient>;
}) {
  if (args.clientId === "anonymous") return;
  try {
    const { data, error: loadError } = await args.supabase
      .from("table_qr_orders")
      .select("payload")
      .eq("tenant_id", args.context.tenant_id)
      .eq("branch_id", args.context.branch_id)
      .eq("id", args.submissionId)
      .eq("qr_session_id", args.context.id)
      .maybeSingle<{ payload: Record<string, unknown> | null }>();
    if (loadError) {
      console.warn("[table-qr-ordering] duplicate fingerprint payload load failed", { submissionId: args.submissionId, message: loadError.message });
      return;
    }
    const payload = data?.payload && typeof data.payload === "object" ? data.payload : {};
    const { error: updateError } = await args.supabase
      .from("table_qr_orders")
      .update({
        payload: {
          ...payload,
          client_id: args.clientId,
          payload_fingerprint: args.payloadFingerprint,
          payload_fingerprint_version: 1
        }
      })
      .eq("tenant_id", args.context.tenant_id)
      .eq("branch_id", args.context.branch_id)
      .eq("id", args.submissionId)
      .eq("qr_session_id", args.context.id);
    if (updateError) {
      console.warn("[table-qr-ordering] duplicate fingerprint payload update failed", { submissionId: args.submissionId, message: updateError.message });
    }
  } catch (error) {
    console.warn("[table-qr-ordering] duplicate fingerprint payload marking skipped", {
      submissionId: args.submissionId,
      message: error instanceof Error ? error.message : "fingerprint_mark_failed"
    });
  }
}'''
replace_once_or_verify(qr, old_mark, new_mark)

replace_once_or_verify(
    qr,
    '''  await markQrOrderPayloadFingerprint({ context, submissionId: row.submission_id, clientId, payloadFingerprint, supabase });

  if (!row.duplicate_request) {
    await queueTableQrKitchenPrints({ context, orderId: row.order_id, requestId });
    invalidatePosBranchRuntimeCaches({ tenantId: context.tenant_id, branchId: context.branch_id });
  }

  return row;''',
    '''  if (!row.duplicate_request) {
    await queueTableQrKitchenPrints({ context, orderId: row.order_id, requestId });
    invalidatePosBranchRuntimeCaches({ tenantId: context.tenant_id, branchId: context.branch_id });
  }

  await markQrOrderPayloadFingerprint({ context, submissionId: row.submission_id, clientId, payloadFingerprint, supabase });
  return row;''',
)

mobile = Path("apps/backoffice-web/src/components/table-order/table-order-mobile.tsx")
replace_once_or_verify(mobile, "const MENU_STATUS_POLL_MS = 15_000;", "const MENU_STATUS_POLL_MS = 3_000;")
replace_once_or_verify(
    mobile,
    '  const submitInFlightRef = useRef<{ requestId: string; fingerprint: string } | null>(null);',
    '  const submitInFlightRef = useRef<{ requestId: string; fingerprint: string } | null>(null);\n  const submitRetryRef = useRef<{ requestId: string; fingerprint: string } | null>(null);',
)
replace_once_or_verify(
    mobile,
    '''    const fingerprint = buildSubmitFingerprint(items);
    if (submitInFlightRef.current?.fingerprint === fingerprint) return;
    const requestId = buildRequestId();
    submitInFlightRef.current = { requestId, fingerprint };''',
    '''    const fingerprint = buildSubmitFingerprint(items);
    if (submitInFlightRef.current?.fingerprint === fingerprint) return;
    const retry = submitRetryRef.current;
    const requestId = retry?.fingerprint === fingerprint ? retry.requestId : buildRequestId();
    submitRetryRef.current = { requestId, fingerprint };
    submitInFlightRef.current = { requestId, fingerprint };''',
)
replace_once_or_verify(
    mobile,
    '''      const orderNo = body.data.order_no ?? "-";
      setSuccessOrderNo(orderNo);''',
    '''      const orderNo = body.data.order_no ?? "-";
      if (submitRetryRef.current?.requestId === requestId) submitRetryRef.current = null;
      setSuccessOrderNo(orderNo);''',
)

pos = Path("apps/backoffice-web/src/components/pos/pos-sales-module.tsx")
replace_once_or_verify(
    pos,
    '    if (orderType !== "dine_in" || !selectedTable?.id || !selectedTable.active_session_id || !shift || shift.status !== "open" || cart.length === 0 || !isOnline) return null;\n    const cartSnapshot = cloneCartItems(cart);\n    const signature = buildCartSignature(cartSnapshot);\n    const committedSignature = buildCartSignature(committedDineInCartByTableIdRef.current[selectedTable.id] ?? []);\n    if (signature === committedSignature) return null;',
    '''    if (orderType !== "dine_in" || !selectedTable?.id || !selectedTable.active_session_id || !shift || shift.status !== "open" || !isOnline) return null;
    const cartSnapshot = cloneCartItems(cart);
    const signature = buildCartSignature(cartSnapshot);
    const committedCart = committedDineInCartByTableIdRef.current[selectedTable.id] ?? [];
    const committedSignature = buildCartSignature(committedCart);
    if (signature === committedSignature) return null;
    const canClearExistingDineIn =
      cartSnapshot.length === 0 &&
      activeOrder?.status === "queued" &&
      (!activeOrder.table_id || activeOrder.table_id === selectedTable.id) &&
      (committedCart.length > 0 || lastCommittedCartSignature !== null);
    if (cartSnapshot.length === 0 && !canClearExistingDineIn) return null;''',
)
replace_once_or_verify(
    pos,
    '    const job = dineInAutoSendJobsRef.current.get(tableId);\n    if (!job || job.cart.length === 0) return;\n    const committedSignature = buildCartSignature(committedDineInCartByTableIdRef.current[tableId] ?? []);',
    '''    const job = dineInAutoSendJobsRef.current.get(tableId);
    if (!job) return;
    const committedCart = committedDineInCartByTableIdRef.current[tableId] ?? [];
    const committedSignature = buildCartSignature(committedCart);
    const canClearExistingDineIn =
      job.cart.length === 0 &&
      job.activeOrder?.status === "queued" &&
      (committedCart.length > 0 || (selectedTableRef.current?.id === tableId && lastCommittedCartSignature !== null));
    if (job.cart.length === 0 && !canClearExistingDineIn) {
      dineInAutoSendJobsRef.current.delete(tableId);
      return;
    }''',
)
replace_once_or_verify(
    pos,
    '    pushSubmitMessage(`กำลังส่งรายการเข้าครัว: ${job.table.table_code}`);\n    try {\n      const latestTaxSettings = await refreshTaxSettings();',
    '''    pushSubmitMessage(`กำลังส่งรายการเข้าครัว: ${job.table.table_code}`);
    try {
      if (job.cart.length === 0 && job.activeOrder?.status === "queued") {
        const clearResponse = await fetch("/api/pos/sales/clear-dine-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: job.activeOrder.id, table_id: tableId })
        });
        const clearBody = (await clearResponse.json().catch(() => null)) as
          | { data?: { total_amount?: number }; error?: { message?: string } }
          | null;
        if (!clearResponse.ok) {
          throw new Error(clearBody?.error?.message || "Unable to clear dine-in bill items.");
        }
        const clearedOrder: ActiveOrder = {
          ...job.activeOrder,
          total_amount: Number(clearBody?.data?.total_amount ?? 0)
        };
        committedDineInCartByTableIdRef.current = {
          ...committedDineInCartByTableIdRef.current,
          [tableId]: []
        };
        rememberDineInDraft(tableId, []);
        if (selectedTableRef.current?.id === tableId) {
          setActiveOrder(clearedOrder);
          setLastCommittedCartSignature(job.signature);
        }
        void fetchPosTables().catch(() => undefined);
        return;
      }

      const latestTaxSettings = await refreshTaxSettings();''',
)

test = Path("apps/backoffice-web/tests/integration/table-qr-postcommit-stability.integration.test.ts")
test.write_text('''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const server = source("../../src/lib/table-qr-ordering.ts");
const mobile = source("../../src/components/table-order/table-order-mobile.tsx");

describe("table QR post-commit stability", () => {
  it("scopes fingerprint mutation and makes enrichment non-fatal", () => {
    expect(server).toContain('.eq("tenant_id", args.context.tenant_id)');
    expect(server).toContain('.eq("branch_id", args.context.branch_id)');
    expect(server).toContain("duplicate fingerprint payload marking skipped");
  });

  it("queues kitchen printing before non-authoritative fingerprint enrichment", () => {
    const queueAt = server.indexOf("await queueTableQrKitchenPrints({ context, orderId: row.order_id, requestId });");
    const markAt = server.indexOf("await markQrOrderPayloadFingerprint({ context, submissionId: row.submission_id");
    expect(queueAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(queueAt);
  });

  it("reuses the same idempotency key after an uncertain submit result", () => {
    expect(mobile).toContain("const submitRetryRef = useRef<{ requestId: string; fingerprint: string } | null>(null);");
    expect(mobile).toContain("retry?.fingerprint === fingerprint ? retry.requestId : buildRequestId()");
    expect(mobile).toContain("submitRetryRef.current = { requestId, fingerprint };");
  });

  it("refreshes authoritative cashier bill state quickly", () => {
    expect(mobile).toContain("const MENU_STATUS_POLL_MS = 3_000;");
  });
});
''', encoding="utf-8")

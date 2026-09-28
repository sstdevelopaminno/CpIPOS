import { createClient } from "npm:@supabase/supabase-js@2";

type Batch = {
  id: string;
  tenant_id: string;
  package_code: string | null;
  retention_months: number;
  cutoff_at: string;
  range_start_at: string | null;
  range_end_at: string | null;
  status: string;
  orders_object_path: string | null;
  items_object_path: string | null;
  payments_object_path: string | null;
  manifest_object_path: string | null;
  checksums: Record<string, string> | null;
};

const BUCKET = "sales-retention-exports";
const IT_EMAIL_ENDPOINT = "https://cp-ipos-it-web.vercel.app/api/internal/sales-retention/email";
const PAGE = 1000;
const ORDER_ID_CHUNK = 100;

function adminKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // fall through
    }
  }
  throw new Error("missing_supabase_admin_key");
}

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function csvCell(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let valueText = String(value);
  // Prevent spreadsheet formula execution when a customer opens the CSV.
  if (/^[=+\-@]/.test(valueText)) valueText = "'" + valueText;
  if (/[",\r\n]/.test(valueText)) valueText = '"' + valueText.replaceAll('"', '""') + '"';
  return valueText;
}

function csv(headers: string[], rows: Record<string, unknown>[]) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => csvCell(row[key])).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

async function fetchChildren(
  db: ReturnType<typeof createClient>,
  table: "order_items" | "payments",
  columns: string,
  orderIds: string[]
) {
  const rows: Record<string, unknown>[] = [];
  for (const ids of chunks(orderIds, ORDER_ID_CHUNK)) {
    let from = 0;
    while (true) {
      const { data, error } = await db
        .from(table)
        .select(columns)
        .in("order_id", ids)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}_read_failed:${error.message}`);
      const pageRows = (data ?? []) as Record<string, unknown>[];
      rows.push(...pageRows);
      if (pageRows.length < PAGE) break;
      from += PAGE;
    }
  }
  return rows;
}

async function uploadText(
  db: ReturnType<typeof createClient>,
  path: string,
  body: string,
  contentType: string
) {
  const { error } = await db.storage.from(BUCKET).upload(
    path,
    new Blob([body], { type: contentType }),
    { contentType, cacheControl: "3600", upsert: true }
  );
  if (error) throw new Error(`storage_upload_failed:${path}:${error.message}`);
}

async function exportBatch(db: ReturnType<typeof createClient>, batchId: string) {
  const { data: batchData, error: batchError } = await db
    .from("sales_retention_batches")
    .select("id,tenant_id,package_code,retention_months,cutoff_at,range_start_at,range_end_at,status")
    .eq("id", batchId)
    .maybeSingle<Batch>();
  if (batchError || !batchData) throw new Error("retention_batch_missing");

  await db.from("sales_retention_batches").update({
    status: "exporting",
    export_attempt_count: 1,
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq("id", batchId).in("status", ["claimed", "failed"]);

  const membership: string[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("sales_retention_batch_orders")
      .select("order_id")
      .eq("batch_id", batchId)
      .order("order_created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`retention_membership_read_failed:${error.message}`);
    const pageRows = (data ?? []) as Array<{ order_id: string }>;
    membership.push(...pageRows.map((row) => row.order_id));
    if (pageRows.length < PAGE) break;
    from += PAGE;
  }
  if (!membership.length) throw new Error("retention_batch_empty");

  const orders: Record<string, unknown>[] = [];
  for (const ids of chunks(membership, ORDER_ID_CHUNK)) {
    const { data, error } = await db
      .from("orders")
      .select("id,tenant_id,branch_id,shift_id,order_no,order_type,channel,customer_name,subtotal,discount_amount,gp_amount,total_amount,status,cancelled_reason,created_by,created_at,updated_at,request_id,cash_received,change_amount,payment_completed_at,payment_completed_by,device_code,cashier_user_id,grand_total,tax_total,paid_total")
      .in("id", ids)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`orders_read_failed:${error.message}`);
    orders.push(...((data ?? []) as Record<string, unknown>[]));
  }
  if (orders.length !== membership.length) {
    throw new Error(`retention_order_count_mismatch:${orders.length}/${membership.length}`);
  }

  const items = await fetchChildren(
    db,
    "order_items",
    "id,tenant_id,branch_id,order_id,product_id,name,quantity,unit_price,line_total,notes,created_at",
    membership
  );
  const payments = await fetchChildren(
    db,
    "payments",
    "id,tenant_id,branch_id,order_id,method,amount,reference_no,received_by,received_at,created_at,status",
    membership
  );

  const orderHeaders = [
    "id","tenant_id","branch_id","shift_id","order_no","order_type","channel","customer_name",
    "subtotal","discount_amount","gp_amount","total_amount","grand_total","tax_total","paid_total",
    "status","cancelled_reason","created_by","created_at","updated_at","request_id","cash_received",
    "change_amount","payment_completed_at","payment_completed_by","device_code","cashier_user_id"
  ];
  const itemHeaders = [
    "id","tenant_id","branch_id","order_id","product_id","name","quantity","unit_price","line_total","notes","created_at"
  ];
  const paymentHeaders = [
    "id","tenant_id","branch_id","order_id","method","amount","reference_no","received_by","received_at","created_at","status"
  ];

  const ordersCsv = csv(orderHeaders, orders);
  const itemsCsv = csv(itemHeaders, items);
  const paymentsCsv = csv(paymentHeaders, payments);
  const [ordersHash, itemsHash, paymentsHash] = await Promise.all([
    sha256Hex(ordersCsv),
    sha256Hex(itemsCsv),
    sha256Hex(paymentsCsv)
  ]);

  const grossTotal = orders.reduce((sum, row) => {
    const value = Number(row.grand_total ?? row.total_amount ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const paidTotal = payments.reduce((sum, row) => {
    const value = Number(row.amount ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const year = new Date(batchData.range_end_at || Date.now()).getUTCFullYear();
  const folder = `${batchData.tenant_id}/${year}/${batchId}`;
  const ordersPath = `${folder}/orders.csv`;
  const itemsPath = `${folder}/items.csv`;
  const paymentsPath = `${folder}/payments.csv`;
  const manifestPath = `${folder}/manifest.json`;

  const manifest = {
    version: 1,
    batch_id: batchId,
    tenant_id: batchData.tenant_id,
    package_code: batchData.package_code,
    retention_months: batchData.retention_months,
    cutoff_at: batchData.cutoff_at,
    range_start_at: batchData.range_start_at,
    range_end_at: batchData.range_end_at,
    created_at: new Date().toISOString(),
    counts: { orders: orders.length, items: items.length, payments: payments.length },
    totals: {
      gross_total: Number(grossTotal.toFixed(2)),
      paid_total: Number(paidTotal.toFixed(2)),
      currency: "THB"
    },
    files: {
      orders: { path: ordersPath, sha256: ordersHash },
      items: { path: itemsPath, sha256: itemsHash },
      payments: { path: paymentsPath, sha256: paymentsHash }
    },
    policy: {
      products_deleted: false,
      tax_invoice_orders_excluded: true,
      purge_safety_days_after_email: 7
    }
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  const manifestHash = await sha256Hex(manifestText);

  await uploadText(db, ordersPath, ordersCsv, "text/csv;charset=utf-8");
  await uploadText(db, itemsPath, itemsCsv, "text/csv;charset=utf-8");
  await uploadText(db, paymentsPath, paymentsCsv, "text/csv;charset=utf-8");
  await uploadText(db, manifestPath, manifestText, "application/json;charset=utf-8");

  const { error: completeError } = await db.rpc("complete_sales_retention_export", {
    p_batch_id: batchId,
    p_orders_object_path: ordersPath,
    p_items_object_path: itemsPath,
    p_payments_object_path: paymentsPath,
    p_manifest_object_path: manifestPath,
    p_checksums: {
      orders: ordersHash,
      items: itemsHash,
      payments: paymentsHash,
      manifest: manifestHash
    },
    p_order_count: orders.length,
    p_item_count: items.length,
    p_payment_count: payments.length,
    p_gross_total: Number(grossTotal.toFixed(2)),
    p_paid_total: Number(paidTotal.toFixed(2))
  });
  if (completeError) throw new Error(`retention_export_complete_failed:${completeError.message}`);

  return { batchId, orders: orders.length, items: items.length, payments: payments.length };
}

async function sendArchiveEmail(db: ReturnType<typeof createClient>, batchId: string) {
  const { data: token, error } = await db.rpc("issue_sales_retention_email_token", { p_batch_id: batchId });
  if (error || !token) throw new Error(`retention_email_token_failed:${error?.message ?? "missing_token"}`);

  const response = await fetch(IT_EMAIL_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ batch_id: batchId, token }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; status?: string; error?: string } | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`retention_email_dispatch_failed:${payload?.error ?? response.status}`);
  }
  return payload;
}

async function verifyArchiveAndPurge(db: ReturnType<typeof createClient>, batch: Batch) {
  if (!batch.manifest_object_path || !batch.orders_object_path || !batch.items_object_path || !batch.payments_object_path) {
    throw new Error("retention_archive_paths_missing");
  }

  const { data: manifestBlob, error: manifestError } = await db.storage.from(BUCKET).download(batch.manifest_object_path);
  if (manifestError || !manifestBlob) throw new Error("retention_manifest_missing");
  const manifest = JSON.parse(await manifestBlob.text()) as {
    batch_id?: string;
    files?: Record<string, { path?: string; sha256?: string }>;
  };
  if (manifest.batch_id !== batch.id) throw new Error("retention_manifest_batch_mismatch");

  const folder = batch.manifest_object_path.slice(0, batch.manifest_object_path.lastIndexOf("/"));
  const { data: objects, error: listError } = await db.storage.from(BUCKET).list(folder, { limit: 20 });
  if (listError) throw new Error(`retention_storage_list_failed:${listError.message}`);
  const names = new Set((objects ?? []).map((object) => object.name));
  for (const required of ["orders.csv", "items.csv", "payments.csv", "manifest.json"]) {
    if (!names.has(required)) throw new Error(`retention_archive_file_missing:${required}`);
  }

  const { data: purged, error: purgeError } = await db.rpc("purge_sales_retention_batch", { p_batch_id: batch.id });
  if (purgeError) throw new Error(`retention_purge_failed:${purgeError.message}`);
  return Number(purged ?? 0);
}

async function markFailed(db: ReturnType<typeof createClient>, batchId: string, message: string, status = "failed") {
  await db.from("sales_retention_batches").update({
    status,
    last_error: message.slice(0, 1000),
    updated_at: new Date().toISOString()
  }).eq("id", batchId);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });

  try {
    const body = await request.json().catch(() => null) as { token?: string } | null;
    const token = text(body?.token).trim();
    if (token.length < 32) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const db = createClient(Deno.env.get("SUPABASE_URL")!, adminKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: authorized, error: authError } = await db.rpc("consume_sales_retention_worker_token", { p_token: token });
    if (authError || authorized !== true) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const actions: unknown[] = [];

    // Purge first, but only after the 7-day safety window and after re-verifying
    // the private archive objects still exist.
    const now = new Date().toISOString();
    const { data: purgeRows } = await db
      .from("sales_retention_batches")
      .select("id,tenant_id,package_code,retention_months,cutoff_at,range_start_at,range_end_at,status,orders_object_path,items_object_path,payments_object_path,manifest_object_path,checksums")
      .eq("status", "purge_ready")
      .lte("purge_after", now)
      .order("purge_after", { ascending: true })
      .limit(2);
    for (const row of (purgeRows ?? []) as Batch[]) {
      try {
        const purged = await verifyArchiveAndPurge(db, row);
        actions.push({ type: "purge", batch_id: row.id, purged });
      } catch (error) {
        const message = error instanceof Error ? error.message : "purge_failed";
        await markFailed(db, row.id, message, "purge_ready");
        actions.push({ type: "purge_failed", batch_id: row.id, error: message });
      }
    }

    // Retry an interrupted export before making new claims. Batch membership is
    // already fixed, so this is safe and does not duplicate archived orders.
    const { data: failedExports } = await db
      .from("sales_retention_batches")
      .select("id")
      .eq("status", "failed")
      .is("exported_at", null)
      .order("updated_at", { ascending: true })
      .limit(1);
    for (const row of (failedExports ?? []) as Array<{ id: string }>) {
      try {
        const exported = await exportBatch(db, row.id);
        actions.push({ type: "export_retry", ...exported });
        try {
          const emailResult = await sendArchiveEmail(db, row.id);
          actions.push({ type: "email", batch_id: row.id, result: emailResult });
        } catch (error) {
          const message = error instanceof Error ? error.message : "email_failed";
          await markFailed(db, row.id, message, "email_failed");
          actions.push({ type: "email_failed", batch_id: row.id, error: message });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "export_failed";
        await markFailed(db, row.id, message, "failed");
        actions.push({ type: "export_retry_failed", batch_id: row.id, error: message });
      }
    }

    // Retry exported-but-not-emailed batches before making new archives.
    const { data: emailRows } = await db
      .from("sales_retention_batches")
      .select("id")
      .in("status", ["exported", "email_failed", "email_blocked"])
      .order("updated_at", { ascending: true })
      .limit(2);
    for (const row of (emailRows ?? []) as Array<{ id: string }>) {
      try {
        const result = await sendArchiveEmail(db, row.id);
        actions.push({ type: "email", batch_id: row.id, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "email_failed";
        await markFailed(db, row.id, message, "email_failed");
        actions.push({ type: "email_failed", batch_id: row.id, error: message });
      }
    }

    // Stage/export at most one new batch per daily invocation. This bounds CPU,
    // storage and log ingestion while a backlog is being drained.
    const { data: batchId, error: claimError } = await db.rpc("claim_due_sales_retention_batch", {
      p_max_orders: 2000
    });
    if (claimError) throw new Error(`retention_claim_failed:${claimError.message}`);

    if (batchId) {
      try {
        const exported = await exportBatch(db, String(batchId));
        actions.push({ type: "export", ...exported });
        try {
          const emailResult = await sendArchiveEmail(db, String(batchId));
          actions.push({ type: "email", batch_id: batchId, result: emailResult });
        } catch (error) {
          const message = error instanceof Error ? error.message : "email_failed";
          await markFailed(db, String(batchId), message, "email_failed");
          actions.push({ type: "email_failed", batch_id: batchId, error: message });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "export_failed";
        await markFailed(db, String(batchId), message, "failed");
        actions.push({ type: "export_failed", batch_id: batchId, error: message });
      }
    }

    return Response.json({ ok: true, actions });
  } catch (error) {
    console.error("[sales-retention-worker]", error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "sales_retention_worker_failed"
    }, { status: 500 });
  }
});

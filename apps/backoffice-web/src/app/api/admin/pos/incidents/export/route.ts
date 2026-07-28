import { getAuthContext } from "@/lib/auth-context";
import { buildExcelHtmlBytes, type CsvCellValue } from "@/lib/excel-csv";
import { fail } from "@/lib/http";
import { POS_GUARDS } from "@/lib/pos-resilience";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

function canExport(role: string | null): boolean {
  return role === "owner" || role === "manager";
}

function parseDateInput(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function toBangkokRange(dateIso: string): { fromIso: string; toIso: string } {
  const fromIso = new Date(`${dateIso}T00:00:00+07:00`).toISOString();
  const toIso = new Date(`${dateIso}T23:59:59.999+07:00`).toISOString();
  return { fromIso, toIso };
}

function normalizeMetadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeQueue(action: string): "order" | "payment" | "print" | "general" {
  if (action.includes("order")) return "order";
  if (action.includes("payment")) return "payment";
  if (action.includes("print")) return "print";
  return "general";
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const auth = await getAuthContext({ requireBranchScope: false });
    if (!auth.tenantId) {
      const response = fail("missing_tenant_scope", "Tenant scope is required.", 401);
      response.headers.set("x-admin-pos-incidents-export-ms", String(Date.now() - startedAt));
      return response;
    }

    const { searchParams } = new URL(req.url);
    const dateInput = parseDateInput(searchParams.get("date"));
    if (!dateInput) {
      const response = fail("invalid_date", "date must be YYYY-MM-DD.", 422);
      response.headers.set("x-admin-pos-incidents-export-ms", String(Date.now() - startedAt));
      return response;
    }

    const supabase = getSupabaseServiceClient();
    const { data: branchRoles, error: branchRolesError } = await supabase
      .from("user_branch_roles")
      .select("branch_id,role")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", auth.userId);

    if (branchRolesError) {
      const response = fail("branch_roles_query_failed", branchRolesError.message, 500);
      response.headers.set("x-admin-pos-incidents-export-ms", String(Date.now() - startedAt));
      return response;
    }

    const branchIds = [...new Set((branchRoles ?? []).filter((row) => canExport(String(row.role ?? ""))).map((row) => String(row.branch_id)))];
    if (branchIds.length === 0) {
      const response = fail("forbidden", "Owner/manager role is required.", 403);
      response.headers.set("x-admin-pos-incidents-export-ms", String(Date.now() - startedAt));
      return response;
    }

    const { fromIso, toIso } = toBangkokRange(dateInput);
    const deadLetterSinceIso = new Date(new Date(`${dateInput}T23:59:59.999+07:00`).getTime() - POS_GUARDS.deadLetterWindowMinutes * 60_000).toISOString();

    const [{ data: branchRows, error: branchRowsError }, { data: incidentRows, error: incidentRowsError }] = await Promise.all([
      supabase.from("branches").select("id,name").eq("tenant_id", auth.tenantId).in("id", branchIds),
      supabase
        .from("audit_logs")
        .select("id,branch_id,action,target_table,target_id,metadata,actor_user_id,actor_role,created_at")
        .eq("tenant_id", auth.tenantId)
        .in("branch_id", branchIds)
        .in("action", [
          "pos_order_dead_letter",
          "pos_payment_dead_letter",
          "pos_print_dead_letter",
          "pos_order_retry_all_requested",
          "pos_payment_retry_all_requested"
        ])
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
    ]);

    if (branchRowsError) {
      const response = fail("branches_query_failed", branchRowsError.message, 500);
      response.headers.set("x-admin-pos-incidents-export-ms", String(Date.now() - startedAt));
      return response;
    }
    if (incidentRowsError) {
      const response = fail("incidents_query_failed", incidentRowsError.message, 500);
      response.headers.set("x-admin-pos-incidents-export-ms", String(Date.now() - startedAt));
      return response;
    }

    const branchMap = new Map((branchRows ?? []).map((row) => [String(row.id), String(row.name ?? row.id)]));

    const summary = new Map<string, { branch_name: string; order: number; payment: number; print: number; total: number }>();
    for (const row of incidentRows ?? []) {
      const branchId = String(row.branch_id ?? "");
      const branchName = branchMap.get(branchId) ?? branchId;
      const key = `${branchId}`;
      if (!summary.has(key)) {
        summary.set(key, { branch_name: branchName, order: 0, payment: 0, print: 0, total: 0 });
      }
      const queue = normalizeQueue(String(row.action ?? ""));
      const entry = summary.get(key)!;
      if (queue === "order") entry.order += 1;
      if (queue === "payment") entry.payment += 1;
      if (queue === "print") entry.print += 1;
      entry.total += 1;
    }

    const csvRows: CsvCellValue[][] = [
      ["POS Incident Daily Report"],
      ["Tenant", auth.tenantId],
      ["Date (Asia/Bangkok)", dateInput],
      ["Exported At", new Date().toISOString()],
      ["Dead-letter Window Minutes", POS_GUARDS.deadLetterWindowMinutes],
      ["Window For Health Checks", `${deadLetterSinceIso} - ${toIso}`],
      [],
      ["Branch Summary"],
      ["Branch", "Order Incidents", "Payment Incidents", "Print Incidents", "Total Incidents"]
    ];
    for (const row of summary.values()) {
      csvRows.push([row.branch_name, row.order, row.payment, row.print, row.total]);
    }
    if (summary.size === 0) {
      csvRows.push(["-", 0, 0, 0, 0]);
    }

    csvRows.push([]);
    csvRows.push(["Incident Detail"]);
    csvRows.push(["DateTime", "Branch", "Queue", "Action", "Target Table", "Target ID", "Reason", "Detail", "Actor Role", "Actor User ID"]);

    for (const row of incidentRows ?? []) {
      const metadata = normalizeMetadataRecord(row.metadata);
      csvRows.push([
        row.created_at,
        branchMap.get(String(row.branch_id ?? "")) ?? String(row.branch_id ?? "-"),
        normalizeQueue(String(row.action ?? "")),
        row.action,
        row.target_table,
        row.target_id ?? "",
        String(metadata.reason ?? metadata.code ?? metadata.requested_incidents ?? ""),
        String(metadata.detail ?? metadata.message ?? ""),
        row.actor_role,
        row.actor_user_id
      ]);
    }

    const fileName = `pos-incidents-${dateInput}.xls`;
    return new Response(buildExcelHtmlBytes(csvRows), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "x-admin-pos-incidents-export-ms": String(Date.now() - startedAt)
      }
    });
  } catch (error) {
    const response = fail("admin_pos_incidents_export_failed", error instanceof Error ? error.message : "Unknown error", 500);
    response.headers.set("x-admin-pos-incidents-export-ms", String(Date.now() - startedAt));
    return response;
  }
}

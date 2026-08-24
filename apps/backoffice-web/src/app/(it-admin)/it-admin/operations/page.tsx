import Link from "next/link";
import { requireItSupport } from "@/lib/it-admin-guard";
import { RESERVED_BUFFET_STORE_CODE, storeCodeFamilyLabel } from "@/lib/it-ops-store-family";
import { listTenantSummaries } from "@/lib/services/it-admin/tenant-admin-service";

export const dynamic = "force-dynamic";

type CountResult = { count: number | null; error: { message: string } | null };

async function safeCount(query: PromiseLike<CountResult>): Promise<number | null> {
  const result = await query;
  return result.error ? null : (result.count ?? 0);
}

function metric(value: number | null): string {
  return value === null ? "N/A" : String(value);
}

function statusTone(ok: boolean): { background: string; color: string } {
  return ok
    ? { background: "#ecfdf3", color: "#067647" }
    : { background: "#fff4e5", color: "#b54708" };
}

export default async function ItOperationsCenterPage() {
  const context = await requireItSupport();
  const now = Date.now();
  const liveSince = new Date(now - 5 * 60_000).toISOString();
  const qrSince = new Date(now - 15 * 60_000).toISOString();

  const tenants = await listTenantSummaries(context, { limit: 100, status: "all" });
  const tenantIds = tenants.tenants.map((tenant) => tenant.id);
  const { data: accessCodes } = tenantIds.length
    ? await context.supabase
        .from("tenant_access_codes")
        .select("tenant_id,access_code,is_active")
        .in("tenant_id", tenantIds)
    : { data: [] };

  const codeMap = new Map(
    (accessCodes ?? [])
      .filter((row) => Boolean(row.is_active))
      .map((row) => [String(row.tenant_id), String(row.access_code)])
  );

  const [activeDevices, liveDevices, livePrintAgents, printBacklog, openIncidents, qrFailures15m, ff0001Count] = await Promise.all([
    safeCount(context.supabase.from("branch_devices").select("id", { count: "exact", head: true }).eq("is_active", true)),
    safeCount(
      context.supabase
        .from("branch_devices")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .gte("last_seen_at", liveSince)
    ),
    safeCount(context.supabase.from("print_agents").select("id", { count: "exact", head: true }).gte("last_seen_at", liveSince)),
    safeCount(
      context.supabase
        .from("print_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "retrying"])
    ),
    safeCount(context.supabase.from("pos_device_incidents").select("id", { count: "exact", head: true }).is("resolved_at", null)),
    safeCount(
      context.supabase
        .from("table_qr_timeline_events")
        .select("id", { count: "exact", head: true })
        .eq("success", false)
        .gte("event_at", qrSince)
    ),
    safeCount(
      context.supabase
        .from("tenant_access_codes")
        .select("tenant_id", { count: "exact", head: true })
        .eq("access_code", RESERVED_BUFFET_STORE_CODE)
    )
  ]);

  const activeTenantCount = tenants.tenants.filter((tenant) => tenant.is_active).length;
  const provisioningTenantCount = tenants.tenants.length - activeTenantCount;
  const staleDeviceCount = activeDevices === null || liveDevices === null ? null : Math.max(0, activeDevices - liveDevices);
  const ff0001Available = ff0001Count === 0;

  const rows = tenants.tenants
    .map((tenant) => {
      const storeCode = codeMap.get(tenant.id) ?? tenant.code;
      return { tenant, storeCode, family: storeCodeFamilyLabel(storeCode) };
    })
    .sort((a, b) => a.storeCode.localeCompare(b.storeCode));

  const summaryCards = [
    ["Active Stores", activeTenantCount, "ร้านที่เปิดใช้งาน"],
    ["Provisioning / Inactive", provisioningTenantCount, "ยังไม่เปิดใช้งานจริง"],
    ["Live POS ≤ 5m", liveDevices, `จาก active ${metric(activeDevices)}`],
    ["Stale POS", staleDeviceCount, "ควรตรวจ heartbeat"],
    ["Live Print Agents", livePrintAgents, "heartbeat ≤ 5 นาที"],
    ["Print Backlog", printBacklog, "pending + retrying"],
    ["Open Incidents", openIncidents, "ยังไม่ resolved"],
    ["QR Failures 15m", qrFailures15m, "timeline success=false"]
  ] as const;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="surface">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: "#246af0" }}>24/7 OPERATIONS CENTER</div>
            <h2 style={{ margin: "6px 0" }}>CpIPOS Fleet & Store Operations</h2>
            <p style={{ margin: 0, maxWidth: 760, color: "#607089" }}>
              ภาพรวมร้าน, POS/MDM heartbeat, Print Agent, QR และ incident สำหรับทีม IT โดยรอบนี้เป็น read-only control plane เท่านั้น
            </p>
          </div>
          <div style={{ padding: "8px 12px", borderRadius: 999, fontSize: 12, fontWeight: 800, ...statusTone(context.auth.platformRole === "it_admin") }}>
            {context.auth.platformRole === "it_admin" ? "IT ADMIN · CONTROLLED WRITE LATER" : "IT SUPPORT · READ ONLY"}
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {summaryCards.map(([label, value, note]) => (
          <article key={label} className="surface" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "#718096", fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 30, fontWeight: 900, marginTop: 6 }}>{typeof value === "number" ? value : metric(value)}</div>
            <div style={{ marginTop: 4, fontSize: 11, color: "#8a98aa" }}>{note}</div>
          </article>
        ))}
      </section>

      <section className="surface">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Store Registry Snapshot</h3>
            <p style={{ margin: "4px 0 0", color: "#718096", fontSize: 12 }}>
              Product family ด้านล่างเป็นการจัดกลุ่มจาก prefix เพื่อแสดงผลเท่านั้น ไม่ใช่ feature activation gate
            </p>
          </div>
          <Link href="/it-admin/tenants" style={{ fontWeight: 800, color: "#246af0" }}>เปิด Tenant Admin →</Link>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#718096" }}>
                <th style={{ padding: 10 }}>Store Code</th>
                <th>ร้าน</th>
                <th>Family</th>
                <th>Package</th>
                <th>Branches</th>
                <th>Devices</th>
                <th>Sessions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tenant, storeCode, family }) => (
                <tr key={tenant.id} style={{ borderTop: "1px solid #e8edf3" }}>
                  <td style={{ padding: 11, fontWeight: 900, color: "#246af0" }}>{storeCode || "-"}</td>
                  <td><strong>{tenant.name}</strong><br /><small>{tenant.code}</small></td>
                  <td>{family}</td>
                  <td>{tenant.package_name ?? "-"}</td>
                  <td>{tenant.active_branch_count}/{tenant.branch_count}</td>
                  <td>{tenant.active_device_count}/{tenant.device_count}</td>
                  <td>{tenant.active_session_count}</td>
                  <td>{tenant.is_active ? "Active" : "Inactive / Provisioning"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>Buffet Launch Gate</h3>
          <p style={{ color: "#607089" }}>Reserved code: <strong>{RESERVED_BUFFET_STORE_CODE}</strong></p>
          <div style={{ display: "inline-flex", padding: "7px 10px", borderRadius: 8, fontWeight: 800, ...statusTone(ff0001Available) }}>
            {ff0001Available ? "AVAILABLE · ยังไม่ถูก provision" : "OCCUPIED · ต้องหยุดตรวจ collision"}
          </div>
          <p style={{ fontSize: 11, color: "#8a98aa" }}>การสร้างร้านจริงยังเป็น Phase ถัดไปและต้อง idempotent + scoped เท่านั้น</p>
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>Safety Boundary</h3>
          <ul style={{ margin: 0, paddingLeft: 20, color: "#607089", lineHeight: 1.8 }}>
            <li>ไม่มี global MDM command จากหน้านี้</li>
            <li>ไม่มีการแก้ order/payment/shift เพื่อทำ health ให้เขียว</li>
            <li>Store provisioning และ device actions จะเพิ่มทีหลังพร้อม confirmation + audit</li>
            <li>Restaurant QR และ Buffet ใช้ store/branch/device scope แยกกัน</li>
          </ul>
        </div>
      </section>

      <section className="surface" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/it-admin/support" style={{ fontWeight: 800, color: "#246af0" }}>Support Center →</Link>
        <Link href="/it-admin/monitoring" style={{ fontWeight: 800, color: "#246af0" }}>POS Monitoring →</Link>
        <Link href="/it-admin/audit-logs" style={{ fontWeight: 800, color: "#246af0" }}>Audit Logs →</Link>
      </section>
    </div>
  );
}

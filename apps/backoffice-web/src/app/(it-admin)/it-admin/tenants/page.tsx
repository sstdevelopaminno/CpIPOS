import { requireItSupport } from "@/lib/it-admin-guard";
import { listTenantSummaries } from "@/lib/services/it-admin/tenant-admin-service";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const context = await requireItSupport();
  const result = await listTenantSummaries(context, { limit: 100, status: "all" });
  const ids = result.tenants.map((tenant) => tenant.id);
  const { data: codes } = ids.length
    ? await context.supabase
        .from("tenant_access_codes")
        .select("tenant_id,access_code,is_active")
        .in("tenant_id", ids)
        .eq("is_active", true)
    : { data: [] };
  const codeMap = new Map((codes ?? []).map((row) => [String(row.tenant_id), String(row.access_code)]));

  return (
    <section className="surface">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>ร้านค้าและรหัสร้าน</h2>
          <p>ข้อมูลจริงจาก Production · Store Code · Package · Branch · Device · Session</p>
        </div>
        <span style={{ fontSize: 12, color: "#607089" }}>ทั้งหมด {result.tenants.length} ร้าน</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#718096" }}>
              <th style={{ padding: 10 }}>Store Code</th><th>ร้าน</th><th>แพ็กเกจ</th><th>สาขา</th><th>Devices</th><th>Sessions</th><th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {result.tenants.map((tenant) => (
              <tr key={tenant.id} style={{ borderTop: "1px solid #e8edf3" }}>
                <td style={{ padding: 12, fontWeight: 800, color: "#246af0" }}>{codeMap.get(tenant.id) ?? "-"}</td>
                <td><strong>{tenant.name}</strong><br /><small>{tenant.code}</small></td>
                <td>{tenant.package_name ?? "-"}</td>
                <td>{tenant.active_branch_count}/{tenant.branch_count}</td>
                <td>{tenant.active_device_count}/{tenant.device_count}</td>
                <td>{tenant.active_session_count}</td>
                <td>{tenant.is_active ? "Active" : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 16, fontSize: 11, color: "#77869a" }}>
        IT Support อ่านข้อมูลได้แบบ read-only; การเปิด/แก้/ระงับร้านและการเปลี่ยนแพ็กเกจยังสงวนไว้สำหรับ IT Admin ผ่าน API v1 ที่ provision Store Code + lifecycle จริง
      </p>
    </section>
  );
}

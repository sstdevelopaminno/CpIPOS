import { requireOperator } from "@/lib/auth";
import { loadOperationsSnapshot } from "@/lib/operations";

export const dynamic = "force-dynamic";

function family(code: string) {
  const value = code.toUpperCase();
  if (/^FG\d{4}$/.test(value)) return "Restaurant QR";
  if (/^FF\d{4}$/.test(value)) return "Buffet";
  return "Core / Other";
}

export default async function StoresPage() {
  await requireOperator();
  const snapshot = await loadOperationsSnapshot();
  const ff0001 = snapshot.stores.some((s) => s.store_code.toUpperCase() === "FF0001");

  return (
    <div className="pageStack">
      <section className="hero">
        <div className="eyebrow">STORE REGISTRY</div>
        <h1 className="pageTitle">ทะเบียนร้านกลาง</h1>
        <p className="pageSubtitle">มุมมองรวม tenant, product family, package, branch และ POS สำหรับ Restaurant QR, Buffet และ product line ถัดไป ก่อนเปิด Controlled Provisioning</p>
        <div className="heroMeta">
          <span className={`badge ${ff0001 ? "badgeWarn" : "badgeOk"}`}><span className="statusDot" />FF0001 {ff0001 ? "OCCUPIED" : "AVAILABLE"}</span>
          <span className="softPill">Provisioning mutation disabled</span>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHeader">
          <div><h2>All Stores</h2><p>สถานะจาก production control plane แบบ read-only</p></div>
          <span className="badge badgeInfo">{snapshot.stores.length} STORES</span>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead><tr><th>Store</th><th>Product</th><th>Tenant</th><th>Package</th><th>Branches</th><th>POS</th><th>Session</th><th>Shift</th><th>Status</th></tr></thead>
            <tbody>{snapshot.stores.map((s) => <tr key={s.id}>
              <td><div className="code">{s.store_code}</div></td>
              <td><span className="badge badgeInfo">{family(s.store_code)}</span></td>
              <td><strong>{s.name}</strong><br/><small>{s.code}</small></td>
              <td>{s.package_name ?? "-"}</td>
              <td>{s.active_branch_count}/{s.branch_count}</td>
              <td>{s.live_device_count}/{s.device_count}</td>
              <td>{s.active_session_count}</td>
              <td>{s.open_shift_count}</td>
              <td><span className={`badge ${s.is_active ? "badgeOk" : "badgeWarn"}`}><span className="statusDot" />{s.is_active ? "ACTIVE" : "PROVISIONING / INACTIVE"}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="notice"><span>◈</span><div><strong>Controlled Provisioning จะอยู่ใน Phase 2.</strong> การสร้างร้านใหม่จะใช้ flow: Preflight → Reserve Store Code → Transactional Provisioning → INACTIVE → Postflight → Audit ก่อนมีปุ่ม Activate แยกต่างหาก</div></section>
    </div>
  );
}

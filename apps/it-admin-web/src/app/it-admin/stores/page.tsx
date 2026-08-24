import { requireOperator } from "@/lib/auth";
import { loadOperationsSnapshot } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function StoresPage() {
  await requireOperator();
  const snapshot = await loadOperationsSnapshot();
  const ff0001 = snapshot.stores.some((s) => s.store_code.toUpperCase() === "FF0001");
  return <div className="grid" style={{gap:18}}>
    <section className="surface"><h1 style={{marginTop:0}}>Store Registry</h1><p style={{color:"#607089"}}>ทะเบียนร้านกลางสำหรับ Restaurant QR, Buffet และ product line ถัดไป รอบนี้เป็น read-only ก่อนเปิด Controlled Provisioning</p><div className={`badge ${ff0001?"warn":"ok"}`}>FF0001: {ff0001?"OCCUPIED":"AVAILABLE"}</div></section>
    <section className="surface"><div className="tableWrap"><table className="table"><thead><tr><th>Store Code</th><th>Tenant</th><th>Package</th><th>Branches</th><th>POS</th><th>Session</th><th>Shift</th><th>Status</th></tr></thead><tbody>{snapshot.stores.map((s)=><tr key={s.id}><td className="code">{s.store_code}</td><td><strong>{s.name}</strong><br/><small>{s.code}</small></td><td>{s.package_name ?? "-"}</td><td>{s.active_branch_count}/{s.branch_count}</td><td>{s.live_device_count}/{s.device_count}</td><td>{s.active_session_count}</td><td>{s.open_shift_count}</td><td>{s.is_active?"Active":"Inactive / Provisioning"}</td></tr>)}</tbody></table></div></section>
  </div>;
}

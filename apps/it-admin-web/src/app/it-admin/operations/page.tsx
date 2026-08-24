import { loadOperationsSnapshot } from "@/lib/operations";

export const dynamic = "force-dynamic";

function family(code: string) {
  const upper = code.toUpperCase();
  if (/^FG\d{4}$/.test(upper)) return "Restaurant QR";
  if (/^FF\d{4}$/.test(upper)) return "Buffet";
  return "Core / Other";
}

export default async function OperationsPage() {
  const snapshot = await loadOperationsSnapshot();
  const t = snapshot.totals;
  const stale = Math.max(0, t.devices - t.live_devices);
  const metrics = [
    ["Active Stores", t.active_stores], ["Provisioning", t.provisioning_stores], ["Live POS", t.live_devices], ["Stale POS", stale],
    ["Live Print Agents", t.live_print_agents ?? "N/A"], ["Print Backlog", t.print_backlog ?? "N/A"], ["Open Incidents", t.open_incidents ?? "N/A"], ["QR Failures 15m", t.qr_failures_15m ?? "N/A"]
  ];
  return <div className="grid" style={{gap:18}}>
    <section className="surface"><div style={{fontSize:12,fontWeight:900,color:"#246af0"}}>24/7 OPERATIONS CENTER</div><h1 style={{margin:"7px 0"}}>Fleet & Store Health</h1><p style={{margin:0,color:"#607089"}}>Read-only fleet view. ไม่มีคำสั่ง MDM หรือการแก้ข้อมูลการขายจากหน้านี้</p></section>
    <section className="grid metrics">{metrics.map(([label,value])=><article className="surface metric" key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="surface"><h2 style={{marginTop:0}}>Store Registry Snapshot</h2><div className="tableWrap"><table className="table"><thead><tr><th>Store Code</th><th>ร้าน</th><th>Product Family</th><th>Package</th><th>Branches</th><th>Devices</th><th>Sessions</th><th>Shifts</th><th>Status</th></tr></thead><tbody>{snapshot.stores.map((store)=><tr key={store.id}><td className="code">{store.store_code}</td><td><strong>{store.name}</strong><br/><small>{store.code}</small></td><td>{family(store.store_code)}</td><td>{store.package_name ?? "-"}</td><td>{store.active_branch_count}/{store.branch_count}</td><td>{store.live_device_count}/{store.device_count}</td><td>{store.active_session_count}</td><td>{store.open_shift_count}</td><td><span className={`badge ${store.is_active?"ok":"warn"}`}>{store.is_active?"ACTIVE":"PROVISIONING / INACTIVE"}</span></td></tr>)}</tbody></table></div><p style={{fontSize:11,color:"#8a98aa"}}>Updated {new Date(snapshot.generated_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></section>
  </div>;
}

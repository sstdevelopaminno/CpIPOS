import { requireOperator } from "@/lib/auth";
import { loadOperationsSnapshot } from "@/lib/operations";

export const dynamic = "force-dynamic";

function family(code: string) {
  const upper = code.toUpperCase();
  if (/^FG\d{4}$/.test(upper)) return "Restaurant QR";
  if (/^FF\d{4}$/.test(upper)) return "Buffet";
  return "Core / Other";
}

export default async function OperationsPage() {
  await requireOperator();
  const snapshot = await loadOperationsSnapshot();
  const t = snapshot.totals;
  const stale = Math.max(0, t.devices - t.live_devices);
  const metrics = [
    { label: "Active Stores", value: t.active_stores, tone: "ok" },
    { label: "Provisioning", value: t.provisioning_stores, tone: t.provisioning_stores > 0 ? "warn" : "ok" },
    { label: "Live POS", value: t.live_devices, tone: stale > 0 ? "warn" : "ok" },
    { label: "Stale POS", value: stale, tone: stale > 0 ? "danger" : "ok" },
    { label: "Live Print Agents", value: t.live_print_agents ?? "N/A", tone: "ok" },
    { label: "Print Backlog", value: t.print_backlog ?? "N/A", tone: Number(t.print_backlog ?? 0) > 0 ? "warn" : "ok" },
    { label: "Open Incidents", value: t.open_incidents ?? "N/A", tone: Number(t.open_incidents ?? 0) > 0 ? "danger" : "ok" },
    { label: "QR Failures 15m", value: t.qr_failures_15m ?? "N/A", tone: Number(t.qr_failures_15m ?? 0) > 0 ? "danger" : "ok" }
  ];

  return (
    <div className="pageStack">
      <section className="hero">
        <div className="eyebrow">24/7 OPERATIONS CENTER</div>
        <h1 className="pageTitle">Fleet & Store Health</h1>
        <p className="pageSubtitle">ติดตามสถานะร้าน, POS, กะ, session, Print Agent และ QR จากหน้าเดียว หน้านี้เป็น read-only และไม่มีคำสั่งแก้ข้อมูลการขาย</p>
        <div className="heroMeta"><span className="softPill"><span className="liveDot" />Live health view</span><span className="softPill">No financial mutation</span></div>
      </section>

      <section className="grid metrics">
        {metrics.map((m) => <article className="surface metric" key={m.label}><div className="metricTop"><span>{m.label}</span><i className={`metricAccent ${m.tone}`} /></div><strong>{m.value}</strong></article>)}
      </section>

      <section className="surface">
        <div className="sectionHeader"><div><h2>Store Registry Snapshot</h2><p>สถานะล่าสุดของ tenant และอุปกรณ์ใน fleet</p></div><span className="badge badgeInfo">READ ONLY</span></div>
        <div className="tableWrap">
          <table className="table">
            <thead><tr><th>Store</th><th>Product</th><th>Package</th><th>Branches</th><th>Devices</th><th>Sessions</th><th>Shifts</th><th>Health</th></tr></thead>
            <tbody>{snapshot.stores.map((store) => {
              const healthy = store.is_active && (store.device_count === 0 || store.live_device_count > 0);
              return <tr key={store.id}>
                <td><div className="code">{store.store_code}</div><strong>{store.name}</strong><br/><small>{store.code}</small></td>
                <td><span className="badge badgeInfo">{family(store.store_code)}</span></td>
                <td>{store.package_name ?? "-"}</td>
                <td>{store.active_branch_count}/{store.branch_count}</td>
                <td>{store.live_device_count}/{store.device_count}</td>
                <td>{store.active_session_count}</td>
                <td>{store.open_shift_count}</td>
                <td><span className={`badge ${store.is_active ? (healthy ? "badgeOk" : "badgeWarn") : "badgeWarn"}`}><span className="statusDot" />{store.is_active ? (healthy ? "HEALTHY" : "ATTENTION") : "PROVISIONING"}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p style={{fontSize:9,color:"#8a98aa",marginBottom:0}}>Updated {new Date(snapshot.generated_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>
      </section>
    </div>
  );
}

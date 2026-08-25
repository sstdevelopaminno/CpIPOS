import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { loadOperationsSnapshot } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function ItAdminPage() {
  await requireOperator();
  const snapshot = await loadOperationsSnapshot();
  const t = snapshot.totals;
  const staleDevices = Math.max(0, t.devices - t.live_devices);

  const cards = [
    { label: "Active Stores", value: t.active_stores, note: "ร้านที่เปิดใช้งานจริง", tone: "ok" },
    { label: "Provisioning", value: t.provisioning_stores, note: "รอ onboarding / inactive", tone: t.provisioning_stores > 0 ? "warn" : "ok" },
    { label: "Live POS", value: t.live_devices, note: `จาก ${t.devices} อุปกรณ์`, tone: staleDevices > 0 ? "warn" : "ok" },
    { label: "Print Backlog", value: t.print_backlog ?? "N/A", note: "pending + retrying", tone: Number(t.print_backlog ?? 0) > 0 ? "warn" : "ok" },
    { label: "Open Incidents", value: t.open_incidents ?? "N/A", note: "ยังไม่ resolved", tone: Number(t.open_incidents ?? 0) > 0 ? "danger" : "ok" },
    { label: "QR Failures 15m", value: t.qr_failures_15m ?? "N/A", note: "ความผิดพลาดช่วง 15 นาที", tone: Number(t.qr_failures_15m ?? 0) > 0 ? "danger" : "ok" }
  ];

  return (
    <div className="pageStack">
      <section className="hero">
        <div className="eyebrow">CPIPOS PLATFORM OPERATIONS</div>
        <h1 className="pageTitle">ศูนย์ควบคุมระบบ IT</h1>
        <p className="pageSubtitle">ภาพรวมสุขภาพระบบร้านค้า, POS, MDM, Print Agent และ Incident จาก Control Plane ที่แยก deployment ออกจากระบบขายหน้าร้านโดยสมบูรณ์</p>
        <div className="heroMeta">
          <span className="softPill"><span className="liveDot" />Production monitoring</span>
          <span className="softPill">POS deploy isolated</span>
          <span className="softPill">Global MDM broadcast disabled</span>
          <span className="softPill">Read-only operations mode</span>
        </div>
      </section>

      <section className="grid metrics">
        {cards.map((card) => (
          <article className="surface metric" key={card.label}>
            <div className="metricTop"><span>{card.label}</span><i className={`metricAccent ${card.tone}`} /></div>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="surface">
        <div className="sectionHeader">
          <div><h2>Control Center</h2><p>เข้าสู่โมดูลปฏิบัติการโดยไม่ออกจาก IT deployment</p></div>
          <span className="badge badgeOk"><span className="statusDot" />SAFE MODE</span>
        </div>
        <div className="quickGrid">
          <Link href="/it-admin/operations" className="quickCard"><strong>Operations Center</strong><small>Fleet health, sessions, shifts, queue</small><span className="quickArrow">เปิด Operations →</span></Link>
          <Link href="/it-admin/stores" className="quickCard"><strong>Store Registry</strong><small>FG / FF / package / provisioning</small><span className="quickArrow">เปิด Store Registry →</span></Link>
          <Link href="/it-admin/mdm" className="quickCard"><strong>MDM Control</strong><small>Store → Branch → exact device</small><span className="quickArrow">เปิด MDM →</span></Link>
          <Link href="/it-admin/incidents" className="quickCard"><strong>Incident Center</strong><small>POS, printer, runtime, device events</small><span className="quickArrow">เปิด Incidents →</span></Link>
        </div>
      </section>

      <section className="notice"><span>ℹ</span><div><strong>Deployment isolation active.</strong> การปรับ UI หรือฟังก์ชันของ IT app ไม่ trigger การ build/deploy ระบบ POS ร้านค้า เว้นแต่มีการแก้ shared infrastructure โดยตั้งใจในอนาคต</div></section>
    </div>
  );
}

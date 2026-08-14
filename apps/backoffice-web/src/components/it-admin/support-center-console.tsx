"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Language } from "@/lib/i18n";
import type { SupportCenterSnapshot, SupportDevice } from "@/lib/services/it-admin/support-center-service";
import styles from "./support-center-console.module.css";

type ApiEnvelope = {
  data: { snapshot?: SupportCenterSnapshot } | null;
  error: { code?: string; message?: string } | null;
};

type Tone = "ok" | "warn" | "danger" | "muted";

function tone(status: string): Tone {
  if (["healthy", "live", "active", "online", "ready", "info"].includes(status)) return "ok";
  if (["degraded", "stale", "warning", "retrying", "pending"].includes(status)) return "warn";
  if (["critical", "offline", "failed", "locked", "inactive"].includes(status)) return "danger";
  return "muted";
}

function formatDate(value: string | null, language: Language) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatAge(seconds: number | null, language: Language) {
  if (seconds == null) return language === "th" ? "ไม่เคยพบ" : "Never";
  if (seconds < 60) return language === "th" ? `${seconds} วินาที` : `${seconds}s`;
  if (seconds < 3600) return language === "th" ? `${Math.floor(seconds / 60)} นาที` : `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return language === "th" ? `${Math.floor(seconds / 3600)} ชม.` : `${Math.floor(seconds / 3600)}h`;
  return language === "th" ? `${Math.floor(seconds / 86400)} วัน` : `${Math.floor(seconds / 86400)}d`;
}

function Badge({ value, label }: { value: string; label?: string }) {
  const valueTone = tone(value);
  return <span className={`${styles.badge} ${styles[`tone_${valueTone}`]}`}>{label ?? value}</span>;
}

function Metric({ label, value, detail, valueTone = "muted" }: { label: string; value: string | number; detail: string; valueTone?: Tone }) {
  return (
    <div className={`${styles.metric} ${styles[`metric_${valueTone}`]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function DeviceCard({ device, tenantId, language }: { device: SupportDevice; tenantId: string; language: Language }) {
  const connectionLabel =
    device.connection_state === "live"
      ? language === "th" ? "Live" : "Live"
      : device.connection_state === "stale"
        ? language === "th" ? "Heartbeat ช้า" : "Stale"
        : device.connection_state === "offline"
          ? language === "th" ? "ออฟไลน์" : "Offline"
          : language === "th" ? "ไม่เคยพบ" : "Never seen";

  return (
    <article className={styles.device}>
      <header className={styles.deviceHeader}>
        <div className={styles.deviceIdentity}>
          <div className={styles.deviceIcon}>POS</div>
          <div>
            <div className={styles.rowTitle}>
              <strong>{device.device_name}</strong>
              <Badge value={device.effective_status} />
              {device.is_locked ? <Badge value="locked" /> : null}
            </div>
            <span>{device.branch_name ?? "—"} · {device.device_code} · {device.telemetry_profile}</span>
          </div>
        </div>
        <div className={styles.heartbeat}>
          <i className={`${styles.dot} ${styles[`dot_${tone(device.connection_state)}`]}`} />
          <div><strong>{connectionLabel}</strong><span>{formatAge(device.last_seen_age_seconds, language)}</span></div>
        </div>
      </header>
      <div className={styles.deviceStats}>
        <div><span>OS</span><strong>{[device.platform, device.os_version].filter(Boolean).join(" ") || "—"}</strong></div>
        <div><span>App</span><strong>{device.app_version ?? "—"}</strong></div>
        <div><span>CPU</span><strong>{device.cpu_percent == null ? "—" : `${device.cpu_percent.toFixed(0)}%`}</strong></div>
        <div><span>RAM</span><strong>{device.memory_percent == null ? "—" : `${device.memory_percent.toFixed(0)}%`}</strong></div>
        <div><span>Disk</span><strong>{device.disk_free_gb == null ? "—" : `${device.disk_free_gb.toFixed(1)} GB`}</strong></div>
        <div><span>Battery</span><strong>{device.battery_percent == null ? "—" : `${device.battery_percent.toFixed(0)}%`}</strong></div>
      </div>
      <footer className={styles.deviceFooter}>
        {device.primary_incident ? (
          <div className={styles.incidentBrief}>
            <i className={`${styles.alertDot} ${styles[`severity_${device.primary_incident.severity}`]}`} />
            <div><strong>{device.primary_incident.title}</strong><span>{device.primary_incident.message}</span></div>
          </div>
        ) : (
          <div className={styles.incidentBrief}>
            <i className={`${styles.alertDot} ${styles.severity_info}`} />
            <div><strong>{language === "th" ? "MDM ปกติ" : "MDM healthy"}</strong><span>{language === "th" ? "ไม่พบ incident จาก telemetry ล่าสุด" : "No current telemetry incident"}</span></div>
          </div>
        )}
        <Link href={`/tenants/${tenantId}/devices/${device.id}`}>{language === "th" ? "รายละเอียด" : "Details"} →</Link>
      </footer>
    </article>
  );
}

export function SupportCenterConsole({ language }: { language: Language }) {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [snapshot, setSnapshot] = useState<SupportCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestQuery = useRef("");

  const th = language === "th";
  const copy = {
    title: th ? "ศูนย์บริการลูกค้า 24/7" : "24/7 Customer Support Center",
    subtitle: th ? "ค้นหาร้าน แล้วตรวจ POS, MDM, Print, KDS, Session และเหตุขัดข้องในหน้าจอเดียว" : "Open a store and inspect POS, MDM, print, KDS, sessions and incidents in one workspace.",
    input: th ? "รหัสร้าน 6 หลัก หรือ Tenant Code" : "6-digit store code or Tenant Code",
    search: th ? "เปิดร้าน" : "Open store",
    devices: th ? "เครื่อง POS / MDM" : "POS / MDM devices",
    incidents: th ? "Incident ที่ต้องดูแล" : "Incidents requiring attention",
    print: th ? "Printing & Kitchen" : "Printing & Kitchen",
    customer: th ? "ข้อมูลลูกค้า" : "Customer profile",
    empty: th ? "ใส่รหัสร้านเพื่อเริ่มดูแลลูกค้า" : "Enter a store code to start customer support"
  };

  const load = useCallback(async (raw: string, silent = false) => {
    const code = raw.trim();
    if (!code) return;
    latestQuery.current = code;
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/support/store?code=${encodeURIComponent(code)}`, { cache: "no-store", headers: { accept: "application/json" } });
      const payload = (await response.json()) as ApiEnvelope;
      if (!response.ok || payload.error || !payload.data?.snapshot) throw new Error(payload.error?.message ?? `Support API ${response.status}`);
      if (latestQuery.current !== code) return;
      setSnapshot(payload.data.snapshot);
      setActiveQuery(code);
    } catch (err) {
      if (latestQuery.current !== code) return;
      setError(err instanceof Error ? err.message : "Support lookup failed");
      if (!silent) setSnapshot(null);
    } finally {
      if (latestQuery.current === code) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    if (!activeQuery) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(activeQuery, true);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [activeQuery, load]);

  const attention = useMemo(() => snapshot?.devices.filter((d) => ["critical", "degraded", "offline"].includes(d.effective_status)).length ?? 0, [snapshot]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query);
  }

  return (
    <div className={styles.console}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>SERVICE DESK / MDM / POS OPS</span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <form className={styles.lookup} onSubmit={submit}>
          <label htmlFor="support-store-code">{copy.input}</label>
          <div><input id="support-store-code" value={query} onChange={(e) => setQuery(e.target.value.toUpperCase())} placeholder="100001 / FG0003" autoComplete="off" spellCheck={false} /><button disabled={loading || !query.trim()}>{loading ? "…" : copy.search}</button></div>
          <small>Store code = identifier only · server verifies IT role before every read</small>
        </form>
      </section>

      {error ? <div className={styles.error}><strong>Support lookup error</strong><span>{error}</span></div> : null}

      {!snapshot ? (
        <section className={styles.empty}><code>$ support open --store &lt;STORE_CODE&gt;</code><h2>{copy.empty}</h2><p>{th ? "ข้อมูลสาขา เครื่อง และ incident จะถูก scope ด้วย tenant_id ก่อนทุกครั้ง" : "Branches, devices and incidents are always scoped by tenant_id."}</p></section>
      ) : (
        <>
          <section className={styles.customerBar}>
            <div className={styles.customerMain}>
              <div className={styles.monogram}>{(snapshot.tenant.display_name ?? snapshot.tenant.name).slice(0, 2).toUpperCase()}</div>
              <div><div className={styles.rowTitle}><h2>{snapshot.tenant.display_name ?? snapshot.tenant.name}</h2><Badge value={snapshot.tenant.is_active ? "active" : "inactive"} />{snapshot.lifecycle?.access_locked ? <Badge value="locked" /> : null}</div><p>STORE <b>{snapshot.access_code ?? "—"}</b> · TENANT <b>{snapshot.tenant.code}</b> · {snapshot.branches.length} BRANCH</p></div>
            </div>
            <div className={styles.snapshot}><i className={`${styles.dot} ${styles.dot_ok} ${refreshing ? styles.pulse : ""}`} /><div><strong>{refreshing ? (th ? "กำลังอัปเดต" : "Refreshing") : (th ? "Auto refresh 30s" : "Auto refresh 30s")}</strong><span>{formatDate(snapshot.generated_at, language)}</span></div></div>
          </section>

          <section className={styles.metrics}>
            <Metric label={th ? "เครื่อง Live" : "Live devices"} value={`${snapshot.health.live}/${snapshot.health.registered_devices}`} detail={`${snapshot.health.offline} offline · ${snapshot.health.stale} stale`} valueTone={snapshot.health.offline ? "danger" : "ok"} />
            <Metric label={th ? "ต้องตรวจสอบ" : "Needs attention"} value={attention} detail={`${snapshot.health.critical} critical · ${snapshot.health.degraded} degraded`} valueTone={attention ? "warn" : "ok"} />
            <Metric label={th ? "Session / กะ" : "Sessions / shifts"} value={snapshot.operations.active_sessions} detail={`${snapshot.operations.open_shifts} open shifts`} />
            <Metric label={th ? "Print ค้าง / Retry" : "Print pending / retry"} value={snapshot.operations.printing.pending + snapshot.operations.printing.retrying} detail={`${snapshot.operations.printing.failed} failed / 24h`} valueTone={snapshot.operations.printing.failed || snapshot.operations.printing.retrying ? "danger" : "ok"} />
          </section>

          <div className={styles.columns}>
            <section className={styles.panel}>
              <header><div><span className={styles.eyebrow}>CUSTOMER</span><h3>{copy.customer}</h3></div><Link href={`/tenants/${snapshot.tenant.id}/branches`}>Tenant console →</Link></header>
              <div className={styles.profile}>
                <div><span>{th ? "ผู้ดูแลร้าน" : "Owner"}</span><strong>{snapshot.tenant.owner_name ?? "—"}</strong><small>{snapshot.tenant.owner_phone ?? snapshot.tenant.contact_phone ?? "—"}</small></div>
                <div><span>{th ? "สิทธิ์ใช้งาน" : "Subscription"}</span><strong>{snapshot.contract?.status ?? snapshot.lifecycle?.status ?? "—"}</strong><small>{snapshot.lifecycle?.subscription_expires_at ? formatDate(snapshot.lifecycle.subscription_expires_at, language) : "—"}</small></div>
                <div><span>{th ? "การเข้าถึง" : "Access"}</span><strong>{snapshot.lifecycle?.access_locked ? "LOCKED" : snapshot.tenant.is_active ? "ACTIVE" : "INACTIVE"}</strong><small>{snapshot.lifecycle?.lock_reason ?? snapshot.lifecycle?.data_home ?? "primary"}</small></div>
                <div><span>Contract</span><strong>{snapshot.contract ? `${snapshot.contract.max_devices ?? "∞"} devices` : "—"}</strong><small>{snapshot.contract?.end_date ?? "No end date"}</small></div>
              </div>
            </section>
            <section className={styles.panel}>
              <header><div><span className={styles.eyebrow}>PRINT / KDS</span><h3>{copy.print}</h3></div><span className={styles.window}>24H WINDOW</span></header>
              <div className={styles.ops}><div><span>Jobs</span><strong>{snapshot.operations.printing.jobs_24h}</strong></div><div><span>Printers</span><strong>{snapshot.operations.printing.printers_online}/{snapshot.operations.printing.printers}</strong></div><div><span>Agents</span><strong>{snapshot.operations.printing.agents_online}/{snapshot.operations.printing.agents}</strong></div><div><span>KDS active</span><strong>{snapshot.operations.kitchen.active_tickets}</strong></div></div>
              <div className={styles.badgeRow}><Badge value={snapshot.operations.printing.pending ? "pending" : "healthy"} label={`Pending ${snapshot.operations.printing.pending}`} /><Badge value={snapshot.operations.printing.retrying ? "retrying" : "healthy"} label={`Retry ${snapshot.operations.printing.retrying}`} /><Badge value={snapshot.operations.printing.failed ? "failed" : "healthy"} label={`Failed ${snapshot.operations.printing.failed}`} /><span>KDS 24h {snapshot.operations.kitchen.tickets_24h}</span></div>
            </section>
          </div>

          <section className={styles.fleet}>
            <header><div><span className={styles.eyebrow}>FLEET</span><h3>{copy.devices}</h3></div><div className={styles.legend}><span><i className={styles.legendOk} />{snapshot.health.healthy} healthy</span><span><i className={styles.legendWarn} />{snapshot.health.degraded} degraded</span><span><i className={styles.legendDanger} />{snapshot.health.critical + snapshot.health.offline} critical/offline</span></div></header>
            <div className={styles.deviceGrid}>{snapshot.devices.map((device) => <DeviceCard key={device.id} device={device} tenantId={snapshot.tenant.id} language={language} />)}{!snapshot.devices.length ? <div className={styles.inlineEmpty}>No registered POS devices.</div> : null}</div>
          </section>

          <div className={styles.columns}>
            <section className={styles.panel}>
              <header><div><span className={styles.eyebrow}>INCIDENT QUEUE</span><h3>{copy.incidents}</h3></div><span className={styles.count}>{snapshot.incidents.length}</span></header>
              <div className={styles.list}>{snapshot.incidents.slice(0, 10).map((incident, index) => <div className={styles.listRow} key={`${incident.device_id}-${incident.code}-${index}`}><i className={`${styles.alertDot} ${styles[`severity_${incident.severity}`]}`} /><div><strong>{incident.title}</strong><span>{incident.branch_name ?? "—"} · {incident.device_code}</span></div><Badge value={incident.severity === "critical" ? "critical" : incident.severity === "warning" ? "degraded" : "healthy"} label={incident.severity} /></div>)}{!snapshot.incidents.length ? <div className={styles.inlineEmpty}>{th ? "ไม่พบ incident ปัจจุบัน" : "No current incidents"}</div> : null}</div>
            </section>
            <section className={styles.panel}>
              <header><div><span className={styles.eyebrow}>PRINT FAILURES</span><h3>{th ? "งานพิมพ์ที่ล้มเหลว / Retry" : "Failed / retrying print jobs"}</h3></div><Link href="/it-admin/monitoring">Monitoring →</Link></header>
              <div className={styles.list}>{snapshot.operations.printing.recent_failures.map((job) => <div className={styles.listRow} key={job.id}><i className={`${styles.alertDot} ${job.status === "failed" ? styles.severity_critical : styles.severity_warning}`} /><div><strong>{job.printer_role ?? "printer"} · {job.status}</strong><span>{job.last_error ?? "No agent error message"}</span></div><small className={styles.jobMeta}>retry {job.retry_count}<br />{formatDate(job.created_at, language)}</small></div>)}{!snapshot.operations.printing.recent_failures.length ? <div className={styles.inlineEmpty}>{th ? "ไม่มีงาน failed/retrying ค้าง" : "No failed/retrying jobs"}</div> : null}</div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

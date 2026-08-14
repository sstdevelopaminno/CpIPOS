"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEVICE_COMMAND_TYPES,
  UNSUPPORTED_DEVICE_COMMAND_TYPES,
  type DeviceCommandType
} from "@/lib/device-commands";
import styles from "./device-health-console.module.css";

type ApiEnvelope<T> = {
  data: T;
  error: { code?: string; message?: string } | null;
};

type DeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  status: string;
};

type HealthRow = {
  status: string;
  summary: unknown;
  machine_id: string;
  app_version: string | null;
  runtime_version: string | null;
  last_seen_at: string;
  captured_at: string;
} | null;

type IncidentRow = {
  id: string;
  code: string;
  severity: string;
  title: string;
  message: string;
  detected_at: string;
  resolved_at: string | null;
};

type CommandResult = {
  execution_status?: unknown;
  applied?: unknown;
  reported_at?: unknown;
  agent_surface?: unknown;
  agent_version?: unknown;
  error_code?: unknown;
  error_message?: unknown;
  phase?: unknown;
};

type CommandRow = {
  id: string;
  command_type: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  expires_at: string;
  result: unknown;
};

type HealthResponse = {
  device: DeviceRow;
  health: HealthRow;
  incidents: IncidentRow[];
  commands: CommandRow[];
  permissions: {
    can_issue_commands: boolean;
  };
};

type Tone = "ok" | "warn" | "danger" | "muted" | "info";

const COMMAND_LABELS: Record<DeviceCommandType, string> = {
  request_diagnostics_bundle: "Collect diagnostics",
  reload_ui: "Reload POS UI",
  clear_print_queue: "Clear print queue",
  restart_local_bridge: "Restart local bridge",
  refresh_config: "Refresh runtime config",
  disable_device: "Disable device",
  enable_device: "Enable device",
  test_printer: "Test printer",
  collect_logs: "Collect logs",
  restart_app: "Restart app",
  restart_print_service: "Restart print service",
  retry_failed_print_jobs: "Retry failed print jobs",
  check_update: "Check update"
};

const SAFE_PRIMARY_COMMANDS: DeviceCommandType[] = [
  "request_diagnostics_bundle",
  "test_printer",
  "refresh_config",
  "retry_failed_print_jobs",
  "reload_ui",
  "disable_device",
  "enable_device"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readResult(value: unknown): CommandResult {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function ageText(value: string | null) {
  if (!value) return "ไม่เคยพบ";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds} วินาทีที่แล้ว`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} นาทีที่แล้ว`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ชม.ที่แล้ว`;
  return `${Math.floor(seconds / 86400)} วันที่แล้ว`;
}

function statusTone(value: string): Tone {
  const normalized = value.toLowerCase();
  if (["healthy", "active", "online", "succeeded", "success"].includes(normalized)) return "ok";
  if (["warning", "degraded", "pending", "accepted", "delivered"].includes(normalized)) return "warn";
  if (["critical", "failed", "offline", "expired", "disabled"].includes(normalized)) return "danger";
  if (["unsupported", "info"].includes(normalized)) return "info";
  return "muted";
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? "Request failed.");
  }
  return payload.data;
}

function StatusPill({ value, label }: { value: string; label?: string }) {
  const tone = statusTone(value);
  return <span className={`${styles.pill} ${styles[`tone_${tone}`]}`}>{label ?? value}</span>;
}

function commandExecution(command: CommandRow) {
  const result = readResult(command.result);
  const executionStatus = text(result.execution_status);
  if (executionStatus) return executionStatus;
  return command.status;
}

function isUnsupported(commandType: DeviceCommandType) {
  return UNSUPPORTED_DEVICE_COMMAND_TYPES.some((value) => value === commandType);
}

export function DeviceHealthConsole({ tenantId, deviceId }: { tenantId: string; deviceId: string }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCommand, setBusyCommand] = useState<DeviceCommandType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/devices/${deviceId}/health`, { cache: "no-store" });
      const result = await parseResponse<HealthResponse>(response);
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load device health.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function issueCommand(commandType: DeviceCommandType) {
    if (!data || !data.permissions.can_issue_commands || isUnsupported(commandType)) return;
    setBusyCommand(commandType);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/it-admin/v1/device-commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          branch_id: data.device.branch_id,
          pos_device_id: deviceId,
          command_type: commandType
        })
      });
      await parseResponse(response);
      setSuccess(`ส่งคำสั่ง “${COMMAND_LABELS[commandType]}” แล้ว ระบบจะอัปเดตผล execution เมื่อเครื่องตอบกลับ`);
      await load(true);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Failed to issue command.");
    } finally {
      setBusyCommand(null);
    }
  }

  const unresolvedIncidents = useMemo(
    () => data?.incidents.filter((incident) => !incident.resolved_at).length ?? 0,
    [data]
  );
  const latestCommand = data?.commands[0] ?? null;

  if (loading && !data) {
    return <section className={styles.loading}>กำลังโหลด MDM diagnostics…</section>;
  }

  if (!data) {
    return <section className={styles.errorState}>{error ?? "Device not found."}</section>;
  }

  const { device, health, incidents, commands, permissions } = data;

  return (
    <div className={styles.console}>
      <section className={styles.hero}>
        <div className={styles.identityBlock}>
          <div className={styles.deviceMark}>POS</div>
          <div>
            <div className={styles.titleRow}>
              <h1>{device.device_name}</h1>
              <StatusPill value={device.status} />
              {health ? <StatusPill value={health.status} label={`MDM ${health.status}`} /> : <StatusPill value="offline" label="No heartbeat" />}
            </div>
            <p>{device.device_code} · {device.id}</p>
          </div>
        </div>
        <div className={styles.liveMeta}>
          <span className={styles.liveDot} />
          <div>
            <strong>{health ? ageText(health.last_seen_at) : "ไม่เคยพบ heartbeat"}</strong>
            <span>{health ? formatDateTime(health.last_seen_at) : "—"}</span>
          </div>
        </div>
      </section>

      {success ? <div className={styles.successBanner}>{success}</div> : null}
      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <section className={styles.metrics}>
        <div><span>Health</span><strong>{health?.status ?? "unknown"}</strong><small>latest MDM evaluation</small></div>
        <div><span>Incidents</span><strong>{unresolvedIncidents}</strong><small>unresolved / {incidents.length} recent</small></div>
        <div><span>App</span><strong>{health?.app_version ?? "—"}</strong><small>runtime {health?.runtime_version ?? "—"}</small></div>
        <div><span>Machine</span><strong>{health?.machine_id ?? "—"}</strong><small>{health ? `captured ${ageText(health.captured_at)}` : "no telemetry"}</small></div>
        <div><span>Command</span><strong>{latestCommand ? commandExecution(latestCommand) : "—"}</strong><small>{latestCommand ? latestCommand.command_type : "no command history"}</small></div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <span className={styles.eyebrow}>REMOTE OPERATIONS</span>
            <h2>Device commands</h2>
            <p>{permissions.can_issue_commands ? "คำสั่งถูกส่งผ่าน heartbeat queue และบันทึกผล execution กลับมาใน Command history" : "บัญชี IT Support อ่านข้อมูลได้ แต่ไม่มีสิทธิ์สั่งการเครื่อง"}</p>
          </div>
          <StatusPill value={permissions.can_issue_commands ? "active" : "muted"} label={permissions.can_issue_commands ? "IT ADMIN" : "READ ONLY"} />
        </header>

        <div className={styles.commandGrid}>
          {SAFE_PRIMARY_COMMANDS.map((commandType) => {
            const unsupported = isUnsupported(commandType);
            const disabled = !permissions.can_issue_commands || unsupported || Boolean(busyCommand);
            return (
              <button
                key={commandType}
                type="button"
                className={`${styles.commandButton} ${unsupported ? styles.commandUnsupported : ""}`}
                disabled={disabled}
                title={unsupported ? "Native agent endpoint is not implemented; command is intentionally disabled." : undefined}
                onClick={() => void issueCommand(commandType)}
              >
                <strong>{COMMAND_LABELS[commandType]}</strong>
                <span>{unsupported ? "Unsupported by current native agent" : busyCommand === commandType ? "Sending…" : "Queue command"}</span>
              </button>
            );
          })}
        </div>

        <details className={styles.unsupportedBox}>
          <summary>Agent capabilities / intentionally disabled commands</summary>
          <div>
            {DEVICE_COMMAND_TYPES.filter((commandType) => isUnsupported(commandType)).map((commandType) => (
              <span key={commandType}>{COMMAND_LABELS[commandType]}</span>
            ))}
          </div>
        </details>
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div><span className={styles.eyebrow}>INCIDENTS</span><h2>Recent device incidents</h2></div>
            <span className={styles.countBadge}>{unresolvedIncidents}</span>
          </header>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Severity</th><th>Incident</th><th>Detected</th><th>State</th></tr></thead>
              <tbody>
                {incidents.length === 0 ? <tr><td colSpan={4} className={styles.emptyCell}>No incidents recorded.</td></tr> : incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td><StatusPill value={incident.severity} /></td>
                    <td><strong className={styles.tableTitle}>{incident.title}</strong><span className={styles.tableSub}>{incident.code}</span></td>
                    <td>{formatDateTime(incident.detected_at)}</td>
                    <td>{incident.resolved_at ? <StatusPill value="healthy" label="Resolved" /> : <StatusPill value="warning" label="Open" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div><span className={styles.eyebrow}>COMMAND AUDIT</span><h2>Command history & ACK</h2><p>Delivered หมายถึงส่งถึงเครื่อง; Execution แสดงผลที่ agent รายงานกลับจริง</p></div>
          </header>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Command</th><th>Transport</th><th>Execution</th><th>Reported</th></tr></thead>
              <tbody>
                {commands.length === 0 ? <tr><td colSpan={4} className={styles.emptyCell}>No commands issued yet.</td></tr> : commands.map((command) => {
                  const result = readResult(command.result);
                  const execution = commandExecution(command);
                  const errorMessage = text(result.error_message);
                  return (
                    <tr key={command.id}>
                      <td><strong className={styles.tableTitle}>{command.command_type}</strong><span className={styles.tableSub}>{formatDateTime(command.issued_at)}</span></td>
                      <td><StatusPill value={command.status} /></td>
                      <td><StatusPill value={execution} />{errorMessage ? <span className={styles.commandError}>{errorMessage}</span> : null}</td>
                      <td><span>{formatDateTime(text(result.reported_at) ?? command.delivered_at)}</span><span className={styles.tableSub}>{text(result.agent_surface) ?? "—"}{text(result.agent_version) ? ` · ${text(result.agent_version)}` : ""}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

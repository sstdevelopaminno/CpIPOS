"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type PrinterRow = {
  id: string;
  printer_name: string;
  printer_role: "receipt" | "kitchen" | "report";
  connection_type: "NETWORK_ESC_POS" | "STAR_WEBPRNT" | "LOCAL_BRIDGE" | "BLUETOOTH_BRIDGE";
  ip_address: string | null;
  port: number | null;
  paper_width_mm: 58 | 80;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

type PrintAgentRow = {
  id: string;
  device_id: string | null;
  device_code: string;
  agent_name: string;
  status: "active" | "blocked" | "inactive";
  last_seen_at: string | null;
  last_claim_at: string | null;
  app_version: string | null;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

type BluetoothDevice = {
  id: string;
  name: string;
  address: string | null;
  rssi: number | null;
  paired: boolean;
  connected: boolean;
};

type BridgeEnvelope<TData> = {
  ok: boolean;
  code: string;
  message: string;
  action: string;
  timestamp: string;
  data: TData;
};

type BridgeDebugEntry = {
  at: string;
  attempts: number;
  request: Record<string, unknown>;
  status: number | null;
  response: unknown;
};

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function prettyJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function PrintersModule() {
  const [activePanel, setActivePanel] = useState<"printers" | "agents" | "assignment">("printers");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<BluetoothDevice[]>([]);
  const [agents, setAgents] = useState<PrintAgentRow[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentActionId, setAgentActionId] = useState<string | null>(null);
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentDeviceCode, setAgentDeviceCode] = useState("");
  const [agentVersion, setAgentVersion] = useState("");
  const [agentMetadataText, setAgentMetadataText] = useState("");
  const [createdAgentKey, setCreatedAgentKey] = useState<{ agentName: string; deviceCode: string; key: string } | null>(null);

  const [printerName, setPrinterName] = useState("");
  const [printerRole, setPrinterRole] = useState<PrinterRow["printer_role"]>("receipt");
  const [connectionType, setConnectionType] = useState<PrinterRow["connection_type"]>("NETWORK_ESC_POS");
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(58);
  const [ipAddress, setIpAddress] = useState("");
  const [portValue, setPortValue] = useState("");
  const [metadataText, setMetadataText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [bridgeUrlInput, setBridgeUrlInput] = useState("http://127.0.0.1:3210/print");
  const [bridgeHealth, setBridgeHealth] = useState<{ ok: boolean; code: string; message: string; latencyMs: number | null } | null>(null);
  const [printingBridgeTest, setPrintingBridgeTest] = useState(false);
  const [bridgeDebug, setBridgeDebug] = useState<{
    health: BridgeDebugEntry | null;
    discover: BridgeDebugEntry | null;
    connect: BridgeDebugEntry | null;
    print: BridgeDebugEntry | null;
  }>({
    health: null,
    discover: null,
    connect: null,
    print: null
  });

  const isBluetoothMode = connectionType === "BLUETOOTH_BRIDGE";
  const metadataPlaceholder = useMemo(() => {
    if (connectionType === "STAR_WEBPRNT") {
      return '{"webprnt_url":"http://printer.local/StarWebPRNT/SendMessage"}';
    }
    if (connectionType === "LOCAL_BRIDGE") {
      return '{"bridge_url":"http://127.0.0.1:3210/print","cash_drawer":{"enabled":true,"connectionMode":"printer-kick","openSupported":true,"statusSupported":false,"closeSupported":false,"kickPin":0,"pulseOnMs":50,"pulseOffMs":250,"autoOpenOnCashPayment":false}}';
    }
    if (connectionType === "BLUETOOTH_BRIDGE") {
      return '{"bridge_url":"http://127.0.0.1:3210/print","bluetooth_address":"AA:BB:CC:DD:EE:FF","auto_connect":true,"cash_drawer":{"enabled":true,"connectionMode":"printer-kick","openSupported":true,"statusSupported":false,"closeSupported":false,"kickPin":0,"pulseOnMs":50,"pulseOffMs":250,"autoOpenOnCashPayment":false}}';
    }
    return '{"cash_drawer":{"enabled":true,"connectionMode":"printer-kick","openSupported":true,"statusSupported":false,"closeSupported":false,"kickPin":0,"pulseOnMs":50,"pulseOffMs":250,"autoOpenOnCashPayment":false}}';
  }, [connectionType]);

  const { loading, error, items, pagination } = usePaginatedApi<PrinterRow>("/api/backoffice/printers", {
    page,
    page_size: 10,
    reload: reloadKey
  });

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const response = await fetch("/api/backoffice/printers/agents", { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Load print agents failed.");
      }
      setAgents(Array.isArray(body?.data?.items) ? body.data.items : []);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : "Load print agents failed.");
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activePanel === "agents") {
      void loadAgents();
    }
  }, [activePanel, loadAgents, reloadKey]);

  useEffect(() => {
    if (!isBluetoothMode) return;
    let active = true;
    let timer: number | null = null;

    const checkBridgeHealth = async () => {
      const requestPayload = { bridge_url: bridgeUrlInput.trim() || null };
      let attempts = 0;
      let backoffMs = 350;
      try {
        while (attempts < 3) {
          attempts += 1;
          const response = await fetch("/api/backoffice/printers/bluetooth/health", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload)
          });
          const body = (await readJson(response)) as { data?: BridgeEnvelope<{ latency_ms?: number | null }> } | null;
          const envelope = body?.data;
          if (!active || !envelope) return;
          setBridgeDebug((current) => ({
            ...current,
            health: {
              at: new Date().toISOString(),
              attempts,
              request: requestPayload,
              status: response.status,
              response: body
            }
          }));
          setBridgeHealth({
            ok: envelope.ok === true,
            code: envelope.code,
            message: envelope.message,
            latencyMs: Number.isFinite(Number(envelope.data?.latency_ms)) ? Number(envelope.data?.latency_ms) : null
          });
          if (envelope.ok || attempts >= 3) {
            break;
          }
          await sleep(backoffMs);
          backoffMs = Math.min(2200, backoffMs * 2);
        }
      } catch {
        if (!active) return;
        setBridgeHealth({
          ok: false,
          code: "bridge_health_check_failed",
          message: "Bridge health check failed.",
          latencyMs: null
        });
        setBridgeDebug((current) => ({
          ...current,
          health: {
            at: new Date().toISOString(),
            attempts: Math.max(1, attempts),
            request: requestPayload,
            status: null,
            response: { error: "bridge_health_check_failed" }
          }
        }));
      } finally {
        if (!active) return;
        timer = window.setTimeout(checkBridgeHealth, 8000);
      }
    };

    void checkBridgeHealth();
    return () => {
      active = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [bridgeUrlInput, isBluetoothMode]);

  function applyBluetoothDevice(device: BluetoothDevice) {
    const candidateName = device.name.trim() || device.address || "Bluetooth Printer";
    const metadata = {
      bridge_url: bridgeUrlInput.trim() || "http://127.0.0.1:3210/print",
      bluetooth_address: device.address,
      bluetooth_name: device.name,
      auto_connect: true,
      connect_before_print: true,
      prefer_html_58mm: true,
      paper_width_mm: 58
    };
    setConnectionType("BLUETOOTH_BRIDGE");
    setPaperWidthMm(58);
    setPrinterRole("receipt");
    setPrinterName(candidateName.startsWith("BT ") ? candidateName : `BT ${candidateName}`);
    setIpAddress("");
    setPortValue("");
    setMetadataText(prettyJson(metadata));
    setSubmitSuccess(`Applied Bluetooth device: ${candidateName}`);
  }

  async function handleDiscoverBluetooth() {
    setDiscovering(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const requestPayload = {
        bridge_url: bridgeUrlInput.trim() || null,
        timeout_ms: 9000
      };
      const response = await fetch("/api/backoffice/printers/bluetooth/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      const body = await readJson(response);
      setBridgeDebug((current) => ({
        ...current,
        discover: {
          at: new Date().toISOString(),
          attempts: 1,
          request: requestPayload,
          status: response.status,
          response: body
        }
      }));
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Bluetooth discovery failed.");
      }
      const envelope = body?.data as BridgeEnvelope<{ bridge_url?: string; devices?: BluetoothDevice[] }> | undefined;
      const devices = Array.isArray(envelope?.data?.devices) ? envelope!.data.devices! : [];
      setDiscoveredDevices(devices);
      if (typeof envelope?.data?.bridge_url === "string" && envelope.data.bridge_url.trim().length > 0) {
        setBridgeUrlInput(envelope.data.bridge_url.trim());
      }
      setSubmitSuccess(`${envelope?.message ?? "Discovery done."} Found ${devices.length} device(s).`);
    } catch (discoverError) {
      setDiscoveredDevices([]);
      setSubmitError(discoverError instanceof Error ? discoverError.message : "Unknown error");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleConnectBluetooth(device: BluetoothDevice) {
    setConnectingDeviceId(device.id);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const requestPayload = {
        bridge_url: bridgeUrlInput.trim() || null,
        bluetooth_address: device.address,
        bluetooth_name: device.name,
        auto_connect: true
      };
      let response: Response | null = null;
      let body: unknown = null;
      let envelope: BridgeEnvelope<Record<string, unknown>> | undefined;
      let attempts = 0;
      let backoffMs = 450;

      while (attempts < 3) {
        attempts += 1;
        response = await fetch("/api/backoffice/printers/bluetooth/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload)
        });
        body = await readJson(response);
        envelope = (body as { data?: BridgeEnvelope<Record<string, unknown>> } | null)?.data;
        setBridgeDebug((current) => ({
          ...current,
          connect: {
            at: new Date().toISOString(),
            attempts,
            request: requestPayload,
            status: response?.status ?? null,
            response: body
          }
        }));

        const hasValidationError = response.status === 403 || response.status === 422;
        const isSuccess = response.ok && !(body as { error?: unknown } | null)?.error && envelope?.ok !== false;
        if (isSuccess) {
          break;
        }
        if (attempts >= 3 || hasValidationError) {
          throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? envelope?.message ?? "Bluetooth connect failed.");
        }
        await sleep(backoffMs);
        backoffMs = Math.min(2400, backoffMs * 2);
      }

      applyBluetoothDevice(device);
      setSubmitSuccess(envelope?.message ?? `Bluetooth connected: ${device.name || device.address || "device"}`);
    } catch (connectError) {
      setSubmitError(connectError instanceof Error ? connectError.message : "Unknown error");
    } finally {
      setConnectingDeviceId(null);
    }
  }

  async function handleBridgePrint58Debug() {
    setPrintingBridgeTest(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    const sampleHtml = `<!doctype html><html><head><meta charset="utf-8"/><style>@page{size:58mm 120mm;margin:0}html,body{width:58mm;margin:0;padding:0;font-family:Tahoma,sans-serif;font-size:11px}main{padding:2mm}h1{font-size:12px;margin:0 0 2mm}p{margin:0 0 1mm}</style></head><body><main><h1>Bluetooth 58mm Test</h1><p>Bridge test from printer settings.</p><p>${new Date().toISOString()}</p></main></body></html>`;
    const requestPayload = {
      order_id: null,
      order_no: `BT-TEST-${Date.now()}`,
      receipt_html: sampleHtml
    };
    try {
      const response = await fetch("/api/pos/receipts/bluetooth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      const body = await readJson(response);
      setBridgeDebug((current) => ({
        ...current,
        print: {
          at: new Date().toISOString(),
          attempts: 1,
          request: requestPayload,
          status: response.status,
          response: body
        }
      }));
      if (!response.ok || (body as { error?: unknown } | null)?.error) {
        throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? "Bluetooth print debug failed.");
      }
      const message = (body as { data?: { message?: string } } | null)?.data?.message ?? "Bluetooth print debug complete.";
      setSubmitSuccess(message);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setPrintingBridgeTest(false);
    }
  }

  async function handleCreatePrinter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    let metadata: Record<string, unknown> = {};
    if (metadataText.trim()) {
      try {
        metadata = JSON.parse(metadataText) as Record<string, unknown>;
      } catch {
        setSubmitError("metadata_json must be a valid JSON object.");
        setSubmitting(false);
        return;
      }
    }

    const payload = {
      printer_name: printerName.trim(),
      printer_role: printerRole,
      connection_type: connectionType,
      ip_address: ipAddress.trim() || null,
      port: Number(portValue || 0) || null,
      paper_width_mm: paperWidthMm,
      enabled,
      metadata
    };

    try {
      const response = await fetch("/api/backoffice/printers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await readJson(response);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Create printer failed.");
      }
      setSubmitSuccess(`Printer created: ${body?.data?.printer_name ?? payload.printer_name}`);
      setReloadKey((key) => key + 1);
      setPrinterName("");
      setIpAddress("");
      setPortValue("");
      setMetadataText("");
      setDiscoveredDevices([]);
    } catch (createError) {
      setSubmitError(createError instanceof Error ? createError.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestPrint(printerId: string) {
    setTestingId(printerId);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const response = await fetch("/api/backoffice/printers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printer_id: printerId })
      });
      const body = await readJson(response);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Test print failed.");
      }
      setSubmitSuccess(`Test print queued for printer ${printerId}`);
      setReloadKey((key) => key + 1);
    } catch (testError) {
      setSubmitError(testError instanceof Error ? testError.message : "Unknown error");
    } finally {
      setTestingId(null);
    }
  }

  async function handleCreateAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAgentSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    setCreatedAgentKey(null);

    let metadata: Record<string, unknown> = {};
    if (agentMetadataText.trim()) {
      try {
        metadata = JSON.parse(agentMetadataText) as Record<string, unknown>;
      } catch {
        setSubmitError("agent metadata must be a valid JSON object.");
        setAgentSubmitting(false);
        return;
      }
    }

    try {
      const payload = {
        agent_name: agentName.trim(),
        device_code: agentDeviceCode.trim(),
        app_version: agentVersion.trim() || null,
        metadata
      };
      const response = await fetch("/api/backoffice/printers/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await readJson(response);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Create print agent failed.");
      }
      setCreatedAgentKey({
        agentName: body?.data?.agent?.agent_name ?? payload.agent_name,
        deviceCode: body?.data?.agent?.device_code ?? payload.device_code,
        key: body?.data?.agent_key ?? ""
      });
      setSubmitSuccess("Print agent created. Copy the secret now; it will not be shown again.");
      setAgentName("");
      setAgentDeviceCode("");
      setAgentVersion("");
      setAgentMetadataText("");
      setReloadKey((key) => key + 1);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : "Create print agent failed.");
    } finally {
      setAgentSubmitting(false);
    }
  }

  async function handleUpdateAgent(agentId: string, action: "revoke" | "block") {
    setAgentActionId(agentId);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const response = await fetch("/api/backoffice/printers/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, action })
      });
      const body = await readJson(response);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Update print agent failed.");
      }
      setSubmitSuccess(action === "block" ? "Print agent blocked." : "Print agent revoked.");
      setReloadKey((key) => key + 1);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : "Update print agent failed.");
    } finally {
      setAgentActionId(null);
    }
  }

  return (
    <section className="surface">
      <h2>Printer Settings</h2>
      <p style={{ color: "var(--muted)" }}>Adapter-based printing supports NETWORK_ESC_POS, STAR_WEBPRNT, LOCAL_BRIDGE, and BLUETOOTH_BRIDGE.</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }} aria-label="Printer settings sections">
        {[
          ["printers", "Printers"],
          ["agents", "Print Agents"],
          ["assignment", "Assignment"]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActivePanel(key as typeof activePanel)}
            style={{
              minHeight: 38,
              borderRadius: 8,
              border: "1px solid var(--border)",
              padding: "0 14px",
              fontWeight: 800,
              background: activePanel === key ? "#0f172a" : "#fff",
              color: activePanel === key ? "#fff" : "var(--text)"
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activePanel === "agents" ? (
        <section style={{ marginBottom: 12, border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
          <h3 style={{ margin: "0 0 6px" }}>Local Print Agents</h3>
          <form className="grid cols-4" onSubmit={handleCreateAgent} style={{ marginTop: 10 }}>
            <input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Agent name" required style={{ minHeight: 42, padding: "8px 10px" }} />
            <input value={agentDeviceCode} onChange={(event) => setAgentDeviceCode(event.target.value)} placeholder="Device code เช่น POS-COUNTER-01" required style={{ minHeight: 42, padding: "8px 10px" }} />
            <input value={agentVersion} onChange={(event) => setAgentVersion(event.target.value)} placeholder="App version (optional)" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input value={agentMetadataText} onChange={(event) => setAgentMetadataText(event.target.value)} placeholder='{"os":"windows","station":"counter"}' style={{ minHeight: 42, padding: "8px 10px" }} />
            <button type="submit" disabled={agentSubmitting} style={{ minHeight: 42 }}>
              {agentSubmitting ? "Creating..." : "Create agent secret"}
            </button>
          </form>
          {createdAgentKey ? (
            <div style={{ marginTop: 10, border: "1px solid #fed7aa", background: "#fff7ed", borderRadius: 8, padding: 10 }}>
              <strong>Copy this secret now. It is shown once only.</strong>
              <p style={{ margin: "6px 0", color: "var(--muted)", fontSize: 12 }}>
                {createdAgentKey.agentName} / {createdAgentKey.deviceCode}
              </p>
              <code style={{ display: "block", overflowX: "auto", padding: 8, background: "#fff", border: "1px solid var(--border)", borderRadius: 6 }}>
                {createdAgentKey.key}
              </code>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(createdAgentKey.key)} style={{ marginTop: 8, minHeight: 34 }}>
                Copy secret
              </button>
            </div>
          ) : null}
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Agent</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Device</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Status</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Last seen</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agentsLoading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 8 }}>Loading agents...</td>
                  </tr>
                ) : agents.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 8 }}>No print agents yet.</td>
                  </tr>
                ) : (
                  agents.map((agent) => (
                    <tr key={agent.id}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        <strong>{agent.agent_name}</strong>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{agent.app_version ?? "-"}</div>
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{agent.device_code}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{agent.status}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{agent.last_seen_at ? new Date(agent.last_seen_at).toLocaleString() : "-"}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, display: "flex", gap: 8 }}>
                        <button type="button" disabled={agentActionId === agent.id || agent.status !== "active"} onClick={() => void handleUpdateAgent(agent.id, "revoke")} style={{ minHeight: 34 }}>
                          Revoke
                        </button>
                        <button type="button" disabled={agentActionId === agent.id || agent.status === "blocked"} onClick={() => void handleUpdateAgent(agent.id, "block")} style={{ minHeight: 34 }}>
                          Block
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activePanel === "assignment" ? (
        <section style={{ marginBottom: 12, border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
          <h3 style={{ margin: "0 0 6px" }}>Printer Assignment</h3>
          <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: 13 }}>
            For multiple cashier machines in one branch, bind a printer by adding metadata such as <code>agent_device_code</code>, <code>agent_device_codes</code>, <code>assigned_agent_id</code>, or <code>assigned_agent_ids</code>.
          </p>
          <code>{'{"agent_device_code":"POS-COUNTER-01","bridge_timeout_ms":8000}'}</code>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Cash drawer profile example: <code>{'{"cash_drawer":{"enabled":true,"connectionMode":"printer-kick","openSupported":true,"statusSupported":false,"closeSupported":false,"kickPin":0,"pulseOnMs":50,"pulseOffMs":250,"autoOpenOnCashPayment":false}}'}</code>
          </p>
        </section>
      ) : null}

      <form className="grid cols-4" onSubmit={handleCreatePrinter}>
        <input
          name="printer_name"
          value={printerName}
          onChange={(event) => setPrinterName(event.target.value)}
          placeholder="Printer name"
          required
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <select name="printer_role" value={printerRole} onChange={(event) => setPrinterRole(event.target.value as PrinterRow["printer_role"])} style={{ minHeight: 42 }}>
          <option value="receipt">receipt</option>
          <option value="kitchen">kitchen</option>
          <option value="report">report</option>
        </select>
        <select
          name="connection_type"
          value={connectionType}
          onChange={(event) => setConnectionType(event.target.value as PrinterRow["connection_type"])}
          style={{ minHeight: 42 }}
        >
          <option value="NETWORK_ESC_POS">NETWORK_ESC_POS</option>
          <option value="STAR_WEBPRNT">STAR_WEBPRNT</option>
          <option value="LOCAL_BRIDGE">LOCAL_BRIDGE</option>
          <option value="BLUETOOTH_BRIDGE">BLUETOOTH_BRIDGE</option>
        </select>
        <select
          name="paper_width_mm"
          value={String(paperWidthMm)}
          onChange={(event) => setPaperWidthMm(Number(event.target.value) === 80 ? 80 : 58)}
          style={{ minHeight: 42 }}
        >
          <option value="58">58mm</option>
          <option value="80">80mm</option>
        </select>
        <input
          name="ip_address"
          value={ipAddress}
          onChange={(event) => setIpAddress(event.target.value)}
          placeholder="ip_address (for network printer)"
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <input
          name="port"
          type="number"
          value={portValue}
          onChange={(event) => setPortValue(event.target.value)}
          placeholder="port (default 9100)"
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <input
          name="metadata_json"
          value={metadataText}
          onChange={(event) => setMetadataText(event.target.value)}
          placeholder={metadataPlaceholder}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input name="enabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Enabled
        </label>
        <button type="submit" disabled={submitting} style={{ minHeight: 42 }}>
          {submitting ? "Saving..." : "Add printer"}
        </button>
      </form>

      {isBluetoothMode ? (
        <section style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: "0 0 8px" }}>Bluetooth Discovery & Auto Connect</h3>
          <div style={{ marginBottom: 8, fontSize: 12, color: bridgeHealth?.ok ? "#067647" : "#b42318" }}>
            Bridge status: {bridgeHealth ? (bridgeHealth.ok ? "online" : "offline") : "checking"}
            {bridgeHealth?.latencyMs != null ? ` (${bridgeHealth.latencyMs}ms)` : ""}
            {bridgeHealth?.message ? ` - ${bridgeHealth.message}` : ""}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
            <input
              value={bridgeUrlInput}
              onChange={(event) => setBridgeUrlInput(event.target.value)}
              placeholder="bridge_url (e.g. http://127.0.0.1:3210/print)"
              style={{ minHeight: 40, padding: "8px 10px" }}
            />
            <button type="button" onClick={() => void handleDiscoverBluetooth()} disabled={discovering} style={{ minHeight: 40, padding: "0 16px" }}>
              {discovering ? "Scanning..." : "Scan Bluetooth"}
            </button>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>
            Select a device below to auto-fill metadata and auto-connect.
          </p>
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={() => void handleBridgePrint58Debug()} disabled={printingBridgeTest} style={{ minHeight: 34 }}>
              {printingBridgeTest ? "Testing print..." : "Debug Print 58mm"}
            </button>
          </div>

          {discoveredDevices.length > 0 ? (
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Device</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Address</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Status</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {discoveredDevices.map((device) => (
                    <tr key={device.id}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        <strong>{device.name || "-"}</strong>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>RSSI: {device.rssi ?? "-"}</div>
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{device.address ?? "-"}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        {device.connected ? "connected" : "not connected"} / {device.paired ? "paired" : "not paired"}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => applyBluetoothDevice(device)} style={{ minHeight: 34 }}>
                          Use device
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleConnectBluetooth(device)}
                          disabled={connectingDeviceId === device.id}
                          style={{ minHeight: 34 }}
                        >
                          {connectingDeviceId === device.id ? "Connecting..." : "Auto connect"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {isBluetoothMode ? (
        <details style={{ marginTop: 10 }}>
          <summary>Bridge Debug Panel (raw response)</summary>
          <pre style={{ marginTop: 8, maxHeight: 260, overflow: "auto", background: "#f8fafc", border: "1px solid var(--border)", padding: 10, borderRadius: 8 }}>
            {JSON.stringify(bridgeDebug, null, 2)}
          </pre>
        </details>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
        <p style={{ margin: "0 0 6px" }}>Bluetooth metadata examples:</p>
        <p style={{ margin: "0 0 4px" }}>
          <code>{'{"bridge_url":"http://127.0.0.1:3210/print","bluetooth_address":"AA:BB:CC:DD:EE:FF","auto_connect":true}'}</code>
        </p>
        <p style={{ margin: 0 }}>
          <code>{'{"bridge_url":"http://127.0.0.1:3210/print","bluetooth_name":"MTP-II","auto_connect":true}'}</code>
        </p>
      </div>

      {submitError ? <ErrorState message={submitError} /> : null}
      {submitSuccess ? <p style={{ color: "#067647" }}>{submitSuccess}</p> : null}

      {loading ? <LoadingState label="Loading printers..." /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState label="No printers configured yet." /> : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Name</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Role</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Connection</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Address</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Paper</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Enabled</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((printer) => (
                  <tr key={printer.id}>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.printer_name}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.printer_role}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.connection_type}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {printer.ip_address ? `${printer.ip_address}:${printer.port ?? 9100}` : "-"}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.paper_width_mm}mm</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{printer.enabled ? "yes" : "no"}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      <button type="button" disabled={testingId === printer.id} onClick={() => handleTestPrint(printer.id)} style={{ minHeight: 36 }}>
                        {testingId === printer.id ? "Testing..." : "Test print"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10 }}>
            <PaginationControls page={pagination.page} totalPages={pagination.total_pages} onPageChange={setPage} />
          </div>
        </>
      ) : null}
    </section>
  );
}

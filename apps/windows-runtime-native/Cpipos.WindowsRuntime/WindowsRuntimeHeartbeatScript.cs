namespace Cpipos.WindowsRuntime;

internal static class WindowsRuntimeHeartbeatScript
{
    public static string Build()
    {
        return """
(function() {
  try {
    var HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
    var HEARTBEAT_MIN_GAP_MS = 60 * 1000;
    var state = {
      timer: null,
      inFlight: false,
      lastSentAt: 0,
      offlineSince: null
    };

    function runtimePayload() {
      return window.CpIPOSWindowsRuntime || {};
    }

    function readStorage(storage, key) {
      try {
        return storage.getItem(key);
      } catch (error) {
        return null;
      }
    }

    function writeStorage(storage, key, value) {
      try {
        storage.setItem(key, value);
      } catch (error) {
        // Ignore private mode/quota errors. Heartbeat must never block POS operations.
      }
    }

    function getMachineId(runtime) {
      var existing = readStorage(window.localStorage, 'cpi_windows_runtime_machine_id_v1');
      if (existing) return existing;
      var seed = [
        'win',
        runtime.store_code || 'store',
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 10)
      ].join('-');
      writeStorage(window.localStorage, 'cpi_windows_runtime_machine_id_v1', seed);
      return seed;
    }

    function getDeviceCode(runtime) {
      return readStorage(window.localStorage, 'cpi_pos_device_code_v1') ||
        readStorage(window.localStorage, 'cpi_selected_device_code_v1') ||
        readStorage(window.localStorage, 'cpi_windows_runtime_device_code_v1') ||
        runtime.device_code ||
        runtime.store_code ||
        'POS-WINDOWS';
    }

    async function readBridgeHealth(runtime) {
      if (!runtime.bridge_health_url) return { ok: false, data: null, error: 'missing_bridge_health_url' };
      var response = await fetch(runtime.bridge_health_url, { cache: 'no-store' });
      var body = await response.json().catch(function() { return null; });
      if (!response.ok || !body || body.ok === false) {
        return { ok: false, data: body && body.data ? body.data : null, error: body && body.error ? body.error.message : 'bridge_health_failed' };
      }
      return { ok: true, data: body.data || null, error: null };
    }

    function numberOrNull(value) {
      return typeof value === 'number' && isFinite(value) ? value : null;
    }

    function stringOrNull(value) {
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    function buildOfflineSaleHealth() {
      var queueCount = Number(readStorage(window.localStorage, 'cpi_offline_sale_queue_count_v1') || '0');
      var failedCount = Number(readStorage(window.localStorage, 'cpi_offline_sale_failed_count_v1') || '0');
      var totalAmount = Number(readStorage(window.localStorage, 'cpi_offline_sale_total_amount_v1') || '0');
      var lastSyncAt = readStorage(window.localStorage, 'cpi_offline_sale_last_sync_at_v1');
      var offlineSince = readStorage(window.localStorage, 'cpi_offline_sale_offline_since_v1') || state.offlineSince;
      var offlineDays = null;

      if (offlineSince) {
        var offlineTime = Date.parse(offlineSince);
        if (isFinite(offlineTime)) {
          offlineDays = Math.max(0, Math.floor((Date.now() - offlineTime) / 86400000));
        }
      }

      return {
        last_sync_at: stringOrNull(lastSyncAt),
        offline_sale_enabled: true,
        offline_sale_queue_count: isFinite(queueCount) ? queueCount : 0,
        offline_sale_failed_count: isFinite(failedCount) ? failedCount : 0,
        offline_sale_total_amount: isFinite(totalAmount) ? totalAmount : 0,
        offline_since_days: offlineDays
      };
    }

    async function sendHeartbeat(reason) {
      var now = Date.now();
      if (state.inFlight) return;
      if (reason !== 'startup' && now - state.lastSentAt < HEARTBEAT_MIN_GAP_MS) return;

      var runtime = runtimePayload();
      var heartbeatUrl = runtime.windows_runtime_device_heartbeat_url || readStorage(window.localStorage, 'cpi_windows_runtime_device_heartbeat_url_v1') || '/api/pos/device-heartbeat';
      var capturedAt = new Date().toISOString();
      var browserOnline = navigator.onLine !== false;

      if (!browserOnline && !state.offlineSince) {
        state.offlineSince = capturedAt;
        writeStorage(window.localStorage, 'cpi_offline_sale_offline_since_v1', state.offlineSince);
      }

      if (browserOnline) {
        state.offlineSince = null;
      }

      state.inFlight = true;
      var startedAt = Date.now();
      var bridge = { ok: false, data: null, error: null };

      try {
        bridge = await readBridgeHealth(runtime);
      } catch (error) {
        bridge = { ok: false, data: null, error: error && error.message ? error.message : 'bridge_health_unavailable' };
      }

      var bridgeData = bridge.data || {};
      var payload = {
        identity: {
          device_code: getDeviceCode(runtime),
          machine_id: getMachineId(runtime),
          hostname: null,
          windows_username: null,
          runtime_version: runtime.native_bridge_version || bridgeData.bridge_version || null,
          app_version: runtime.native_app_version || null
        },
        connectivity: {
          internet_online: browserOnline,
          server_reachable: true,
          dns_healthy: null,
          network_type: 'webview2',
          ip_address: null,
          latency_ms: Date.now() - startedAt,
          offline_since: state.offlineSince,
          last_seen_at: capturedAt
        },
        system: {
          os_name: 'Windows',
          os_version: null,
          uptime_seconds: numberOrNull(bridgeData.uptime_seconds),
          cpu_percent: null,
          memory_percent: null,
          disk_total_gb: null,
          disk_free_gb: null,
          disk_used_percent: null,
          clock_drift_seconds: null,
          power_status: null
        },
        runtime: {
          cpi_windows_runtime_running: true,
          local_bridge_online: bridge.ok === true,
          bridge_version: bridgeData.bridge_version || runtime.native_bridge_version || null,
          bridge_port: numberOrNull(bridgeData.port),
          token_required: bridgeData.token_required === true,
          request_slots_available: numberOrNull(bridgeData.request_slots_available),
          print_queue_busy: bridgeData.print_queue_busy === true,
          drawer_queue_busy: bridgeData.drawer_queue_busy === true,
          printed_jobs: numberOrNull(bridgeData.printed_jobs),
          failed_jobs: numberOrNull(bridgeData.failed_jobs),
          drawer_commands: numberOrNull(bridgeData.drawer_commands),
          last_error: stringOrNull(bridgeData.last_error || bridge.error)
        },
        peripherals: {
          default_printer: stringOrNull(bridgeData.system_default_printer),
          selected_printer: stringOrNull(bridgeData.resolved_printer || bridgeData.configured_printer),
          selected_printer_valid: bridgeData.selected_printer_valid === true,
          printer_status: bridgeData.selected_printer_valid === false ? 'invalid' : 'normal',
          print_queue_count: null,
          last_print_at: bridgeData.last_print_at || null,
          cash_drawer_supported: bridgeData.supports_cash_drawer === true,
          last_drawer_at: bridgeData.last_drawer_at || null,
          last_drawer_device: bridgeData.last_drawer_device || null
        },
        offline_sale: buildOfflineSaleHealth(),
        security_signals: [],
        metadata: {
          source: 'windows_runtime_webview2_heartbeat',
          reason: reason || 'interval',
          app_url: runtime.app_url || location.origin,
          bridge_health_url_configured: Boolean(runtime.bridge_health_url),
          heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS
        },
        captured_at: capturedAt
      };

      try {
        var response = await fetch(heartbeatUrl, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        state.lastSentAt = Date.now();
        writeStorage(window.localStorage, 'cpi_windows_runtime_last_heartbeat_at_v1', new Date().toISOString());
        writeStorage(window.localStorage, 'cpi_windows_runtime_last_heartbeat_status_v1', response.ok ? 'ok' : 'failed');
      } catch (error) {
        writeStorage(window.localStorage, 'cpi_windows_runtime_last_heartbeat_status_v1', 'failed');
        writeStorage(window.localStorage, 'cpi_windows_runtime_last_heartbeat_error_v1', error && error.message ? error.message : 'heartbeat_failed');
      } finally {
        state.inFlight = false;
      }
    }

    function startHeartbeat() {
      if (state.timer) return;
      window.setTimeout(function() { sendHeartbeat('startup'); }, 15000);
      state.timer = window.setInterval(function() { sendHeartbeat('interval'); }, HEARTBEAT_INTERVAL_MS);
    }

    window.addEventListener('online', function() { sendHeartbeat('online'); });
    window.addEventListener('offline', function() { sendHeartbeat('offline'); });
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') sendHeartbeat('visible');
    });

    startHeartbeat();
  } catch (error) {
    console.warn('CpIPOS Windows Runtime heartbeat bootstrap failed', error);
  }
})();
""";
    }
}

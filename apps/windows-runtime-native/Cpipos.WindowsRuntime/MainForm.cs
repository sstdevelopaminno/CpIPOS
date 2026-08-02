using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace Cpipos.WindowsRuntime;

internal sealed class MainForm : Form
{
    private readonly RuntimeOptions _options;
    private readonly LocalPrintBridge _bridge;
    private readonly WebView2 _webView;
    private bool _isFullscreen;

    public MainForm(RuntimeOptions options, LocalPrintBridge bridge)
    {
        _options = options;
        _bridge = bridge;

        Text = "CpIPOS";
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        KeyPreview = true;
        Width = 1280;
        Height = 800;
        MinimumSize = new Size(1024, 640);
        FormBorderStyle = FormBorderStyle.Sizable;
        WindowState = FormWindowState.Maximized;
        MaximizeBox = true;
        MinimizeBox = true;
        ControlBox = true;
        ShowIcon = true;
        ShowInTaskbar = true;

        TryLoadApplicationIcon();

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.White
        };

        Controls.Add(_webView);

        if (_options.Fullscreen)
        {
            EnterFullscreen();
        }

        Shown += async (_, _) => await InitializeWebViewAsync();
        KeyDown += HandleKeyDown;
        FormClosing += (_, _) => _bridge.Dispose();
    }

    private void TryLoadApplicationIcon()
    {
        try
        {
            var associatedIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (associatedIcon != null)
            {
                Icon = associatedIcon;
            }
        }
        catch
        {
            // Keep the default Windows icon when a custom icon is not embedded.
        }
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CpIPOS",
                "WindowsRuntime",
                "WebView2Profile");
            Directory.CreateDirectory(userDataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
            await _webView.EnsureCoreWebView2Async(environment);

            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = _options.EnableDevTools;
            _webView.CoreWebView2.Settings.AreDevToolsEnabled = _options.EnableDevTools;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

            _webView.CoreWebView2.WebMessageReceived += (_, eventArgs) =>
            {
                var message = eventArgs.TryGetWebMessageAsString();
                if (string.Equals(message, "retry", StringComparison.OrdinalIgnoreCase))
                {
                    NavigateToApp();
                    return;
                }

                if (string.Equals(message, "close", StringComparison.OrdinalIgnoreCase))
                {
                    Close();
                }
            };

            _webView.CoreWebView2.NavigationCompleted += (_, eventArgs) =>
            {
                if (!eventArgs.IsSuccess)
                {
                    ShowOfflinePage(eventArgs.WebErrorStatus.ToString());
                }
            };

            await _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildRuntimeBootstrapScript());
            NavigateToApp();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                this,
                "CpIPOS เปิดระบบไม่สำเร็จ\n\n" + ex.Message + "\n\nกรุณาตรวจสอบ Microsoft Edge WebView2 Runtime และอินเทอร์เน็ตของเครื่อง",
                "CpIPOS",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private string BuildRuntimeBootstrapScript()
    {
        var payload = new
        {
            runtime = "windows_native_webview2",
            identity_anchor = "store_code",
            store_code = _options.StoreCode,
            native_app_version = "0.1.3",
            native_bridge_version = _bridge.Version,
            bridge_health_url = _options.BridgeHealthUrl,
            bridge_print_url = _options.BridgePrintUrl,
            windows_printer = _options.WindowsPrinter,
            windows_runtime_bootstrap_url = _options.WindowsRuntimeBootstrapUrl,
            windows_runtime_entitlements_url = _options.WindowsRuntimeEntitlementsUrl,
            windows_runtime_sync_status_url = _options.WindowsRuntimeSyncStatusUrl
        };
        var json = JsonSerializer.Serialize(payload);
        return $@"
(function() {{
  try {{
    var payload = {json};
    window.CpIPOSWindowsRuntime = payload;
    window.localStorage.setItem('cpi_windows_runtime_enabled_v1', '1');
    window.localStorage.setItem('cpi_windows_runtime_identity_anchor_v1', 'store_code');
    if (payload.store_code) {{
      window.localStorage.setItem('cpi_windows_runtime_store_code_v1', payload.store_code);
    }} else {{
      window.localStorage.removeItem('cpi_windows_runtime_store_code_v1');
    }}
    window.localStorage.setItem('cpi_windows_runtime_bootstrap_url_v1', payload.windows_runtime_bootstrap_url);
    window.localStorage.setItem('cpi_windows_runtime_entitlements_url_v1', payload.windows_runtime_entitlements_url);
    window.localStorage.setItem('cpi_windows_runtime_sync_status_url_v1', payload.windows_runtime_sync_status_url);
    window.localStorage.setItem('cpi_print_adapter_mode_v1', 'LOCAL_BRIDGE_WINDOWS');
    window.localStorage.setItem('cpi_local_bridge_print_url_v1', payload.bridge_print_url);
    window.localStorage.setItem('cpi_local_bridge_health_url_v1', payload.bridge_health_url);
    window.localStorage.removeItem('cpi_windows_runtime_dev_full_access_v1');
  }} catch (error) {{
    console.warn('CpIPOS Windows Runtime bootstrap failed', error);
  }}
}})();";
    }

    private void NavigateToApp()
    {
        if (_webView.CoreWebView2 == null) return;
        _webView.CoreWebView2.Navigate(_options.AppUrl);
    }

    private void ShowOfflinePage(string reason)
    {
        _webView.NavigateToString(OfflinePage.Build(reason));
    }

    private void HandleKeyDown(object? sender, KeyEventArgs eventArgs)
    {
        if (eventArgs.KeyCode == Keys.F11)
        {
            ToggleFullscreen();
            eventArgs.Handled = true;
            return;
        }

        if (eventArgs.KeyCode == Keys.Escape && _isFullscreen)
        {
            ExitFullscreen();
            eventArgs.Handled = true;
            return;
        }

        if (eventArgs.Control && eventArgs.KeyCode == Keys.R)
        {
            NavigateToApp();
            eventArgs.Handled = true;
            return;
        }

        if (eventArgs.Control && eventArgs.KeyCode == Keys.Q)
        {
            Close();
            eventArgs.Handled = true;
            return;
        }

        if (_options.EnableDevTools && eventArgs.Control && eventArgs.Shift && eventArgs.KeyCode == Keys.D)
        {
            _webView.CoreWebView2?.OpenDevToolsWindow();
            eventArgs.Handled = true;
        }
    }

    private void ToggleFullscreen()
    {
        if (_isFullscreen)
        {
            ExitFullscreen();
        }
        else
        {
            EnterFullscreen();
        }
    }

    private void EnterFullscreen()
    {
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        _isFullscreen = true;
    }

    private void ExitFullscreen()
    {
        FormBorderStyle = FormBorderStyle.Sizable;
        WindowState = FormWindowState.Maximized;
        MaximizeBox = true;
        MinimizeBox = true;
        ControlBox = true;
        _isFullscreen = false;
    }
}

internal static class OfflinePage
{
    public static string Build(string reason)
    {
        var safeReason = System.Net.WebUtility.HtmlEncode(reason);
        return $$"""
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Offline</title>
  <style>
    body { margin:0; font-family: Tahoma, Arial, sans-serif; background:#f1f5f9; color:#0f172a; display:flex; min-height:100vh; align-items:center; justify-content:center; }
    .card { width:min(720px, calc(100vw - 48px)); background:white; border:1px solid #dbe4f0; border-radius:20px; padding:28px; box-shadow:0 20px 70px rgba(15,23,42,.12); }
    h1 { margin:0 0 12px; font-size:28px; }
    p { color:#475569; line-height:1.65; }
    code { display:block; background:#f8fafc; border:1px solid #dbe4f0; border-radius:12px; padding:12px; color:#334155; overflow:auto; }
    button { border:0; border-radius:12px; padding:12px 18px; font-weight:700; background:#0ea5e9; color:white; cursor:pointer; margin-right:8px; }
    button.secondary { background:#334155; }
    .muted { color:#64748b; font-size:13px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>CpIPOS</h1>
    <p>ยังเชื่อมต่อระบบออนไลน์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง</p>
    <code>สถานะ: {{safeReason}}</code>
    <p>การใช้งานครั้งแรกต้องออนไลน์เพื่อให้ระบบหลังบ้าน IT ตรวจรหัสร้านและปลดล็อกแพ็กเกจก่อน จากนั้นจึงใช้ความสามารถ offline ตามแพ็กเกจที่ได้รับ</p>
    <button onclick="chrome.webview.postMessage('retry')">ลองใหม่</button>
    <button class="secondary" onclick="chrome.webview.postMessage('close')">ปิดโปรแกรม</button>
    <p class="muted">ปุ่มลัด: F11 เต็มจอ, Esc ออกจากเต็มจอ, Ctrl+R โหลดใหม่, Ctrl+Q ปิดโปรแกรม</p>
  </main>
</body>
</html>
""";
    }
}

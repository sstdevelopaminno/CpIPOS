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
    private readonly Label _statusLabel;

    public MainForm(RuntimeOptions options, LocalPrintBridge bridge)
    {
        _options = options;
        _bridge = bridge;

        Text = "CpIPOS Windows Runtime";
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(6, 32, 70);
        KeyPreview = true;
        Width = 1280;
        Height = 800;

        if (_options.Fullscreen)
        {
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
        }

        _statusLabel = new Label
        {
            Dock = DockStyle.Top,
            Height = 28,
            ForeColor = Color.White,
            BackColor = Color.FromArgb(7, 40, 86),
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(12, 0, 0, 0),
            Text = $"CpIPOS Windows Runtime | Bridge: {_options.BridgeHealthUrl} | Printer: {(_options.WindowsPrinter.Length > 0 ? _options.WindowsPrinter : "Windows default")}" 
        };

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.White
        };

        Controls.Add(_webView);
        Controls.Add(_statusLabel);

        Shown += async (_, _) => await InitializeWebViewAsync();
        KeyDown += HandleKeyDown;
        FormClosing += (_, _) => _bridge.Dispose();
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

            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

            _webView.CoreWebView2.WebMessageReceived += (_, eventArgs) =>
            {
                var message = eventArgs.TryGetWebMessageAsString();
                if (string.Equals(message, "retry", StringComparison.OrdinalIgnoreCase))
                {
                    NavigateToApp();
                }
            };

            _webView.CoreWebView2.NavigationCompleted += (_, eventArgs) =>
            {
                if (!eventArgs.IsSuccess)
                {
                    ShowOfflinePage($"Navigation failed: {eventArgs.WebErrorStatus}");
                }
            };

            await _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildRuntimeBootstrapScript());
            NavigateToApp();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                this,
                "CpIPOS Windows Runtime เปิด WebView2 ไม่สำเร็จ\n\n" + ex.Message + "\n\nกรุณาติดตั้ง Microsoft Edge WebView2 Runtime หรือเปิด Microsoft Edge ให้พร้อมใช้งาน",
                "CpIPOS Windows Runtime",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private string BuildRuntimeBootstrapScript()
    {
        var payload = new
        {
            runtime = "windows_native_webview2",
            native_app_version = "0.1.0",
            native_bridge_version = _bridge.Version,
            bridge_health_url = _options.BridgeHealthUrl,
            bridge_print_url = _options.BridgePrintUrl,
            windows_printer = _options.WindowsPrinter
        };
        var json = JsonSerializer.Serialize(payload);
        return $@"
(function() {{
  try {{
    var payload = {json};
    window.CpIPOSWindowsRuntime = payload;
    window.localStorage.setItem('cpi_windows_runtime_enabled_v1', '1');
    window.localStorage.setItem('cpi_print_adapter_mode_v1', 'LOCAL_BRIDGE_WINDOWS');
    window.localStorage.setItem('cpi_local_bridge_print_url_v1', payload.bridge_print_url);
    window.localStorage.setItem('cpi_local_bridge_health_url_v1', payload.bridge_health_url);
  }} catch (error) {{
    console.warn('CpIPOS Windows Runtime bootstrap failed', error);
  }}
}})();";
    }

    private void NavigateToApp()
    {
        if (_webView.CoreWebView2 == null) return;
        _statusLabel.Text = $"CpIPOS Windows Runtime | Loading: {_options.AppUrl} | Bridge: {_options.BridgeHealthUrl}";
        _webView.CoreWebView2.Navigate(_options.AppUrl);
    }

    private void ShowOfflinePage(string reason)
    {
        _statusLabel.Text = $"CpIPOS Windows Runtime | Offline fallback | {reason}";
        _webView.NavigateToString(OfflinePage.Build(reason, _options));
    }

    private void HandleKeyDown(object? sender, KeyEventArgs eventArgs)
    {
        if (eventArgs.KeyCode == Keys.F11)
        {
            ToggleFullscreen();
            eventArgs.Handled = true;
            return;
        }

        if (eventArgs.Control && eventArgs.KeyCode == Keys.R)
        {
            NavigateToApp();
            eventArgs.Handled = true;
            return;
        }

        if (eventArgs.Control && eventArgs.Shift && eventArgs.KeyCode == Keys.D)
        {
            _webView.CoreWebView2?.OpenDevToolsWindow();
            eventArgs.Handled = true;
        }
    }

    private void ToggleFullscreen()
    {
        if (FormBorderStyle == FormBorderStyle.None)
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = FormWindowState.Normal;
            Width = 1280;
            Height = 800;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
        }
    }
}

internal static class OfflinePage
{
    public static string Build(string reason, RuntimeOptions options)
    {
        var safeReason = System.Net.WebUtility.HtmlEncode(reason);
        var appUrl = System.Net.WebUtility.HtmlEncode(options.AppUrl);
        var healthUrl = System.Net.WebUtility.HtmlEncode(options.BridgeHealthUrl);
        var printUrl = System.Net.WebUtility.HtmlEncode(options.BridgePrintUrl);
        return $$"""
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS Offline</title>
  <style>
    body { margin:0; font-family: Tahoma, Arial, sans-serif; background:#071b3a; color:white; display:flex; min-height:100vh; align-items:center; justify-content:center; }
    .card { width:min(720px, calc(100vw - 48px)); background:#0b2b5a; border:1px solid #2b5fa8; border-radius:20px; padding:28px; box-shadow:0 20px 70px rgba(0,0,0,.35); }
    h1 { margin:0 0 12px; font-size:28px; }
    p { color:#dce8ff; line-height:1.65; }
    code { display:block; background:#06152c; border:1px solid #274a82; border-radius:12px; padding:12px; color:#b8d4ff; overflow:auto; }
    button { border:0; border-radius:12px; padding:12px 18px; font-weight:700; background:#2b7cff; color:white; cursor:pointer; margin-right:8px; }
    .muted { color:#a7bee7; font-size:13px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>CpIPOS Windows Runtime</h1>
    <p>ยังโหลด POS จากระบบออนไลน์ไม่ได้ โปรแกรมจึงแสดงหน้า fallback ก่อน</p>
    <code>Reason: {{safeReason}}<br>App URL: {{appUrl}}<br>Bridge Health: {{healthUrl}}<br>Bridge Print: {{printUrl}}</code>
    <p>การขาย offline เต็มรูปแบบยังเป็นเฟสถัดไป ต้องมี local database, order queue, payment queue และ sync engine ก่อนใช้งานจริง</p>
    <button onclick="chrome.webview.postMessage('retry')">ลองโหลด POS ใหม่</button>
    <button onclick="location.href='{{healthUrl}}'">เช็ก Bridge</button>
    <p class="muted">ปุ่มลัด: F11 สลับเต็มจอ, Ctrl+R โหลดใหม่, Ctrl+Shift+D เปิด DevTools</p>
  </main>
</body>
</html>
""";
    }
}

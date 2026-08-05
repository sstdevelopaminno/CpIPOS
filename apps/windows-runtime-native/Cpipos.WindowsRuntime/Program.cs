using System.Globalization;
using System.Security.Cryptography;
using System.Windows.Forms;

namespace Cpipos.WindowsRuntime;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var options = RuntimeOptions.FromArgs(args);

        using var bridge = new LocalPrintBridge(options.BridgePort, options.WindowsPrinter, options.BridgeToken);
        try
        {
            bridge.Start();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "CpIPOS เปิด Local Print Bridge ไม่สำเร็จ\n\n" + ex.Message + "\n\nระบบขายยังเปิดได้ แต่การพิมพ์ผ่าน Local Bridge จะไม่พร้อมใช้งานจนกว่าจะปิดโปรแกรมที่ใช้พอร์ตนี้หรือเปลี่ยนพอร์ตใหม่",
                "CpIPOS Local Print Bridge",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }

        Application.Run(new MainForm(options, bridge));
    }
}

internal sealed class RuntimeOptions
{
    private const string ProductionAppUrl = "https://cp-ipos-web.vercel.app/login/store";

    public string AppUrl { get; init; } = ProductionAppUrl;
    public string StoreCode { get; init; } = string.Empty;
    public string WindowsPrinter { get; init; } = string.Empty;
    public int BridgePort { get; init; } = 3210;
    public bool Fullscreen { get; init; }
    public bool EnableDevTools { get; init; }
    public bool AllowCustomAppUrl { get; init; }
    public string BridgeToken { get; init; } = GenerateBridgeToken();

    public string BridgePrintUrl => $"http://127.0.0.1:{BridgePort}/print";
    public string BridgeHealthUrl => $"http://127.0.0.1:{BridgePort}/health";
    public string BridgePrintersUrl => $"http://127.0.0.1:{BridgePort}/printers";
    public string WindowsRuntimeBootstrapUrl => "https://cp-ipos-web.vercel.app/api/windows-runtime/v1/bootstrap";
    public string WindowsRuntimeEntitlementsUrl => "https://cp-ipos-web.vercel.app/api/windows-runtime/v1/entitlements";
    public string WindowsRuntimeSyncStatusUrl => "https://cp-ipos-web.vercel.app/api/windows-runtime/v1/sync/status";

    public static RuntimeOptions FromArgs(string[] args)
    {
        var rawAppUrl = ReadEnv("CPIPOS_APP_URL", ProductionAppUrl);
        var storeCode = NormalizeStoreCode(ReadEnv("CPIPOS_STORE_CODE", string.Empty));
        var printer = ReadEnv("CPIPOS_WINDOWS_PRINTER", string.Empty);
        var bridgePort = ReadIntEnv("CPIPOS_PRINT_BRIDGE_PORT", 3210);
        var fullscreen = string.Equals(ReadEnv("CPIPOS_FULLSCREEN", "0"), "1", StringComparison.OrdinalIgnoreCase);
        var enableDevTools = string.Equals(ReadEnv("CPIPOS_ENABLE_DEVTOOLS", "0"), "1", StringComparison.OrdinalIgnoreCase);
        var allowCustomAppUrl = string.Equals(ReadEnv("CPIPOS_ALLOW_CUSTOM_APP_URL", "0"), "1", StringComparison.OrdinalIgnoreCase);

        foreach (var arg in args)
        {
            if (TryReadValue(arg, "--url=", out var url) && !string.IsNullOrWhiteSpace(url))
            {
                rawAppUrl = url.Trim();
                continue;
            }
            if (TryReadValue(arg, "--store-code=", out var code))
            {
                storeCode = NormalizeStoreCode(code);
                continue;
            }
            if (TryReadValue(arg, "--printer=", out var printerName))
            {
                printer = printerName.Trim();
                continue;
            }
            if (TryReadValue(arg, "--bridge-port=", out var portText) && int.TryParse(portText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedPort))
            {
                bridgePort = parsedPort;
                continue;
            }
            if (string.Equals(arg, "--windowed", StringComparison.OrdinalIgnoreCase))
            {
                fullscreen = false;
                continue;
            }
            if (string.Equals(arg, "--fullscreen", StringComparison.OrdinalIgnoreCase))
            {
                fullscreen = true;
                continue;
            }
            if (string.Equals(arg, "--devtools", StringComparison.OrdinalIgnoreCase))
            {
                enableDevTools = true;
                continue;
            }
            if (string.Equals(arg, "--allow-custom-url", StringComparison.OrdinalIgnoreCase))
            {
                allowCustomAppUrl = true;
            }
        }

        var appUrl = ResolveAppUrl(rawAppUrl, allowCustomAppUrl);

        return new RuntimeOptions
        {
            AppUrl = appUrl,
            StoreCode = storeCode,
            WindowsPrinter = printer,
            BridgePort = bridgePort,
            Fullscreen = fullscreen,
            EnableDevTools = enableDevTools,
            AllowCustomAppUrl = allowCustomAppUrl,
            BridgeToken = GenerateBridgeToken()
        };
    }

    private static string ResolveAppUrl(string value, bool allowCustomAppUrl)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return ProductionAppUrl;
        if (IsProductionAppUri(uri)) return uri.ToString();
        if (allowCustomAppUrl && IsLocalDevelopmentUri(uri)) return uri.ToString();
        return ProductionAppUrl;
    }

    private static bool IsProductionAppUri(Uri uri)
    {
        return uri.Scheme == Uri.UriSchemeHttps &&
               string.Equals(uri.Host, "cp-ipos-web.vercel.app", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsLocalDevelopmentUri(Uri uri)
    {
        return (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) &&
               (string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase));
    }

    private static string ReadEnv(string name, string fallback)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private static int ReadIntEnv(string name, int fallback)
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)) return fallback;
        return parsed >= 1024 && parsed <= 65535 ? parsed : fallback;
    }

    private static bool TryReadValue(string arg, string prefix, out string value)
    {
        if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            value = arg[prefix.Length..];
            return true;
        }
        value = string.Empty;
        return false;
    }

    private static string NormalizeStoreCode(string value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToUpperInvariant().Replace(" ", string.Empty);
    }

    private static string GenerateBridgeToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    }
}


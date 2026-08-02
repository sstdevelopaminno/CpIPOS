using System.Globalization;
using System.Windows.Forms;

namespace Cpipos.WindowsRuntime;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var options = RuntimeOptions.FromArgs(args);

        using var bridge = new LocalPrintBridge(options.BridgePort, options.WindowsPrinter);
        bridge.Start();

        Application.Run(new MainForm(options, bridge));
    }
}

internal sealed class RuntimeOptions
{
    public string AppUrl { get; init; } = "https://cp-ipos-web.vercel.app/login/store";
    public string StoreCode { get; init; } = string.Empty;
    public string WindowsPrinter { get; init; } = string.Empty;
    public int BridgePort { get; init; } = 3210;
    public bool Fullscreen { get; init; }
    public bool EnableDevTools { get; init; }

    public string BridgePrintUrl => $"http://127.0.0.1:{BridgePort}/print";
    public string BridgeHealthUrl => $"http://127.0.0.1:{BridgePort}/health";
    public string WindowsRuntimeBootstrapUrl => "https://cp-ipos-web.vercel.app/api/windows-runtime/v1/bootstrap";
    public string WindowsRuntimeEntitlementsUrl => "https://cp-ipos-web.vercel.app/api/windows-runtime/v1/entitlements";
    public string WindowsRuntimeSyncStatusUrl => "https://cp-ipos-web.vercel.app/api/windows-runtime/v1/sync/status";

    public static RuntimeOptions FromArgs(string[] args)
    {
        var appUrl = ReadEnv("CPIPOS_APP_URL", "https://cp-ipos-web.vercel.app/login/store");
        var storeCode = NormalizeStoreCode(ReadEnv("CPIPOS_STORE_CODE", string.Empty));
        var printer = ReadEnv("CPIPOS_WINDOWS_PRINTER", string.Empty);
        var bridgePort = ReadIntEnv("CPIPOS_PRINT_BRIDGE_PORT", 3210);
        var fullscreen = string.Equals(ReadEnv("CPIPOS_FULLSCREEN", "0"), "1", StringComparison.OrdinalIgnoreCase);
        var enableDevTools = string.Equals(ReadEnv("CPIPOS_ENABLE_DEVTOOLS", "0"), "1", StringComparison.OrdinalIgnoreCase);

        foreach (var arg in args)
        {
            if (TryReadValue(arg, "--url=", out var url) && !string.IsNullOrWhiteSpace(url))
            {
                appUrl = url.Trim();
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
            }
        }

        return new RuntimeOptions
        {
            AppUrl = appUrl,
            StoreCode = storeCode,
            WindowsPrinter = printer,
            BridgePort = bridgePort,
            Fullscreen = fullscreen,
            EnableDevTools = enableDevTools
        };
    }

    private static string ReadEnv(string name, string fallback)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private static int ReadIntEnv(string name, int fallback)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : fallback;
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
}

using System;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Cpipos.WindowsRuntime;

/// <summary>
/// Explicit opt-in fast path for a station with a verified thermal printer.
/// A single prewarmed STA/WebView2 host handles one job at a time under the
/// LocalPrintBridge _printLock. It never retries an uncertain physical print.
/// All other Windows stations retain the existing isolated per-job renderer.
/// </summary>
internal sealed class WarmHtmlReceiptPrinter : IDisposable
{
    private readonly object _gate = new();
    private Task<(Form Host, WebView2 Browser)>? _ready;
    private bool _disposed;

    public async Task WarmAsync(CancellationToken token)
    {
        _ = await GetReadyAsync(token).ConfigureAwait(false);
    }

    private async Task<(Form Host, WebView2 Browser)> GetReadyAsync(CancellationToken token)
    {
        Task<(Form Host, WebView2 Browser)> ready;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_ready == null)
            {
                var source = new TaskCompletionSource<(Form Host, WebView2 Browser)>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                _ready = source.Task;
                var worker = new Thread(() =>
                {
                    Form? host = null;
                    try
                    {
                        host = new Form
                        {
                            ShowInTaskbar = false,
                            FormBorderStyle = FormBorderStyle.None,
                            StartPosition = FormStartPosition.Manual,
                            Location = new Point(-32000, -32000),
                            Size = new Size(380, 1000),
                            Opacity = 0.01
                        };
                        var browser = new WebView2
                        {
                            Dock = DockStyle.Fill,
                            DefaultBackgroundColor = Color.White
                        };
                        host.Controls.Add(browser);
                        host.Shown += async (_, _) =>
                        {
                            try
                            {
                                var profile = Path.Combine(
                                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                    "CpIPOS", "WindowsWebPOS", "ReceiptWebView2");
                                Directory.CreateDirectory(profile);
                                var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
                                await browser.EnsureCoreWebView2Async(environment);
                                source.TrySetResult((host, browser));
                            }
                            catch (Exception error)
                            {
                                source.TrySetException(error);
                                try { host.Close(); } catch { }
                            }
                        };
                        Application.Run(host);
                        source.TrySetException(new InvalidOperationException("Warm receipt renderer exited."));
                    }
                    catch (Exception error)
                    {
                        source.TrySetException(error);
                    }
                    finally
                    {
                        try { host?.Dispose(); } catch { }
                    }
                })
                { IsBackground = true, Name = "CpIPOS-Receipt-WarmSTA" };
                worker.SetApartmentState(ApartmentState.STA);
                worker.Start();
            }
            ready = _ready;
        }
        // Never use another renderer as an implicit fallback: that could
        // duplicate a job whose physical outcome is already indeterminate.
        return await ready.WaitAsync(TimeSpan.FromSeconds(20), token).ConfigureAwait(false);
    }

    public async Task PrintAsync(string html, string printerName, CancellationToken token)
    {
        var context = await GetReadyAsync(token).ConfigureAwait(false);
        if (context.Host.IsDisposed || !context.Host.IsHandleCreated)
            throw new InvalidOperationException("Warm receipt renderer is not running.");

        var source = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        context.Host.BeginInvoke(new Action(async () =>
        {
            try
            {
                await PrintOnStaAsync(context.Browser, html, printerName, token);
                source.TrySetResult(true);
            }
            catch (Exception error)
            {
                source.TrySetException(error);
            }
        }));
        // Timeout is an unknown physical result; caller must not retry.
        await source.Task.WaitAsync(TimeSpan.FromSeconds(25), token).ConfigureAwait(false);
    }

    private static async Task PrintOnStaAsync(
        WebView2 browser, string html, string printerName, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (browser.CoreWebView2 == null)
            throw new InvalidOperationException("Warm WebView2 was not initialized.");

        var navigation = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        EventHandler<CoreWebView2NavigationCompletedEventArgs> onNavigation = (_, args) =>
        {
            if (args.IsSuccess) navigation.TrySetResult(true);
            else navigation.TrySetException(new InvalidOperationException(
                "HTML receipt navigation failed: " + args.WebErrorStatus));
        };
        browser.CoreWebView2.NavigationCompleted += onNavigation;
        try
        {
            browser.CoreWebView2.NavigateToString(html);
            await navigation.Task.WaitAsync(TimeSpan.FromSeconds(12), token);
        }
        finally
        {
            browser.CoreWebView2.NavigationCompleted -= onNavigation;
        }

        var nonce = Guid.NewGuid().ToString("N");
        var ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        EventHandler<CoreWebView2WebMessageReceivedEventArgs> onMessage = (_, args) =>
        {
            string message;
            try { message = args.TryGetWebMessageAsString(); }
            catch { return; }
            if (message == "cpipos-receipt-ready:" + nonce) ready.TrySetResult(true);
            else if (message == "cpipos-receipt-invalid:" + nonce)
                ready.TrySetException(new InvalidOperationException("Empty HTML receipt."));
            else if (message == "cpipos-receipt-error:" + nonce)
                ready.TrySetException(new InvalidOperationException("HTML rendering failed."));
        };
        browser.CoreWebView2.WebMessageReceived += onMessage;
        try
        {
            const string script = """
(async () => {
  const nonce = "__RECEIPT_NONCE__";
  const notify = status => window.chrome.webview.postMessage("cpipos-receipt-" + status + ":" + nonce);
  try {
    const body = document.body;
    const content = body ? (body.textContent || "").trim() : "";
    if (!body || (!content && !body.querySelector("img[src]"))) { notify("invalid"); return; }
    const fonts = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
    const images = Promise.all(Array.from(body.querySelectorAll("img")).map(img =>
      img.complete ? Promise.resolve() : new Promise(resolve => {
        img.addEventListener("load", resolve, {once:true});
        img.addEventListener("error", resolve, {once:true});
      })
    ));
    await Promise.race([Promise.all([fonts, images]),
      new Promise(resolve => setTimeout(resolve, 2500))]);
    notify("ready");
  } catch (_error) { notify("error"); }
})()
""";
            await browser.CoreWebView2.ExecuteScriptAsync(script.Replace("__RECEIPT_NONCE__", nonce));
            await ready.Task.WaitAsync(TimeSpan.FromSeconds(8), token);
        }
        finally
        {
            browser.CoreWebView2.WebMessageReceived -= onMessage;
        }
        token.ThrowIfCancellationRequested();

        var pageWidthMatch = Regex.Match(html,
            @"@page\s*\{[^}]*?\bsize\s*:\s*(58|80)\s*mm",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var printer = new PrinterSettings { PrinterName = printerName };
        if (!printer.IsValid) throw new InvalidOperationException("Windows printer unavailable: " + printerName);
        var driverWidthMm = printer.DefaultPageSettings.PaperSize.Width * 0.254;
        var paperWidthMm = pageWidthMatch.Success
            ? int.Parse(pageWidthMatch.Groups[1].Value)
            : driverWidthMm >= 54 && driverWidthMm <= 62 ? 58 : 80;
        var heightJson = await browser.CoreWebView2.ExecuteScriptAsync(
            "(()=>{const root=document.querySelector('main.receipt,main.receipt58')||document.querySelector('main')||document.body;" +
            "if(!root)return 0;return Math.ceil(Math.max(root.getBoundingClientRect().height,root.scrollHeight));})()");
        if (!int.TryParse(heightJson, out var heightPx) || heightPx <= 0)
            throw new InvalidOperationException("Cannot measure thermal HTML height.");
        var sheetMm = Math.Clamp(Math.Ceiling(heightPx * 25.4 / 96.0) + 16, 100, 700);
        var settings = browser.CoreWebView2.Environment.CreatePrintSettings();
        settings.PrinterName = printerName;
        settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
        settings.PageWidth = paperWidthMm / 25.4;
        settings.PageHeight = sheetMm / 25.4;
        settings.ScaleFactor = 1.0;
        settings.ShouldPrintBackgrounds = true;
        settings.ShouldPrintHeaderAndFooter = false;
        settings.MarginTop = 0;
        settings.MarginRight = 0;
        settings.MarginBottom = 0;
        settings.MarginLeft = 0;
        var outcome = await browser.CoreWebView2.PrintAsync(settings);
        if (outcome != CoreWebView2PrintStatus.Succeeded)
            throw new InvalidOperationException("WebView2 rejected print: " + outcome);
    }

    public void Dispose()
    {
        Task<(Form Host, WebView2 Browser)>? ready;
        lock (_gate) { if (_disposed) return; _disposed = true; ready = _ready; }
        if (ready is not { IsCompletedSuccessfully: true }) return;
        try
        {
            var host = ready.Result.Host;
            if (host.IsHandleCreated && !host.IsDisposed)
                host.BeginInvoke(new Action(host.Close));
        }
        catch { /* form may already be closing */ }
    }
}

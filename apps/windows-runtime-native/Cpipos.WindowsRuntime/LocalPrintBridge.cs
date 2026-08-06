using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Cpipos.WindowsRuntime;

internal sealed class LocalPrintBridge : IDisposable
{
    private static readonly HashSet<string> AllowedOrigins = new(StringComparer.OrdinalIgnoreCase)
    {
        "https://cp-ipos-web.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    };

    private readonly int _port;
    private readonly string _defaultPrinter;
    private readonly string _bridgeToken;
    private readonly CancellationTokenSource _stopping = new();
    private readonly SemaphoreSlim _printLock = new(1, 1);
    private readonly SemaphoreSlim _drawerLock = new(1, 1);
    private readonly SemaphoreSlim _requestSlots = new(16, 16);
    private readonly DateTimeOffset _startedAt = DateTimeOffset.Now;
    private TcpListener? _listener;
    private DateTimeOffset? _lastPrintAt;
    private DateTimeOffset? _lastDrawerAt;
    private string? _lastPrinter;
    private string? _lastDrawerDevice;
    private string? _lastError;
    private int _printedJobs;
    private int _drawerCommands;
    private int _failedJobs;
    private bool _disposed;

    [DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool SetDefaultPrinter(string name);

    public string Version => "cpipos-windows-native-bridge-0.1.6";
    public bool IsRunning { get; private set; }

    public LocalPrintBridge(int port, string defaultPrinter, string bridgeToken)
    {
        _port = port;
        _defaultPrinter = defaultPrinter.Trim();
        _bridgeToken = bridgeToken;
    }

    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _listener = new TcpListener(IPAddress.Parse("127.0.0.1"), _port);
        _listener.Start();
        IsRunning = true;
        _ = Task.Run(() => AcceptLoopAsync(_stopping.Token));
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        if (_listener == null) return;

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var client = await _listener.AcceptTcpClientAsync(cancellationToken).ConfigureAwait(false);
                _ = Task.Run(() => HandleClientAsync(client, cancellationToken), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                try
                {
                    await Task.Delay(250, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken bridgeCancellationToken)
    {
        HttpRequestData? request = null;
        var slotTaken = false;

        try
        {
            slotTaken = await _requestSlots.WaitAsync(TimeSpan.FromSeconds(5), bridgeCancellationToken).ConfigureAwait(false);
            if (!slotTaken)
            {
                using (client)
                using (var stream = client.GetStream())
                {
                    var busy = HttpResponseData.Json(503, new
                    {
                        ok = false,
                        error = new { code = "bridge_busy", message = "Local print bridge has too many open requests." }
                    }, null);
                    await busy.WriteAsync(stream, bridgeCancellationToken).ConfigureAwait(false);
                }
                return;
            }

            using (client)
            using (var stream = client.GetStream())
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(bridgeCancellationToken))
            {
                timeout.CancelAfter(TimeSpan.FromSeconds(30));
                request = await HttpRequestData.ReadAsync(stream, timeout.Token).ConfigureAwait(false);
                var response = await RouteAsync(request, timeout.Token).ConfigureAwait(false);
                await response.WriteAsync(stream, timeout.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException ex)
        {
            _lastError = ex.Message;
            await TryWriteErrorAsync(client, 504, "bridge_request_timeout", "Local bridge request timed out.", ResolveCorsOrigin(request)).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
            await TryWriteErrorAsync(client, 500, "bridge_unhandled_error", ex.Message, ResolveCorsOrigin(request)).ConfigureAwait(false);
        }
        finally
        {
            if (slotTaken) _requestSlots.Release();
        }
    }

    private static async Task TryWriteErrorAsync(TcpClient client, int status, string code, string message, string? corsOrigin)
    {
        try
        {
            using (client)
            using (var stream = client.GetStream())
            {
                var response = HttpResponseData.Json(status, new
                {
                    ok = false,
                    error = new { code, message }
                }, corsOrigin);
                await response.WriteAsync(stream, CancellationToken.None).ConfigureAwait(false);
            }
        }
        catch
        {
            // The client may already be disconnected or disposed.
        }
    }

    private async Task<HttpResponseData> RouteAsync(HttpRequestData request, CancellationToken cancellationToken)
    {
        var corsOrigin = ResolveCorsOrigin(request);

        if (string.Equals(request.Method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
        {
            return HttpResponseData.Empty(204, corsOrigin);
        }

        if (string.Equals(request.Method, "GET", StringComparison.OrdinalIgnoreCase) &&
            (request.Path is "/" or "/health" or "/print/health" or "/print/status"))
        {
            return HttpResponseData.Json(200, BuildHealthPayload(), corsOrigin);
        }

        if (string.Equals(request.Method, "GET", StringComparison.OrdinalIgnoreCase) && request.Path == "/capabilities")
        {
            return HttpResponseData.Json(200, new
            {
                ok = true,
                data = new
                {
                    adapter = "LOCAL_BRIDGE_WINDOWS_NATIVE",
                    bridge_version = Version,
                    token_required = true,
                    allowed_origins = AllowedOrigins.ToArray(),
                    supports_print_receipt = true,
                    supports_html_receipt_print = true,
                    supports_print_test = true,
                    supports_list_printers = true,
                    supports_serialized_print_queue = true,
                    supports_cash_drawer = true,
                    supports_cash_drawer_printer_kick = true,
                    supports_cash_drawer_emergency_printer_kick = true,
                    supports_external_serial_drawer_controller = true,
                    supports_external_network_drawer_controller = true,
                    supports_external_usb_drawer_controller = false,
                    supports_vendor_sdk_drawer_controller = false,
                    supports_offline_sales_engine = false,
                    endpoints = new[]
                    {
                        "/health",
                        "/capabilities",
                        "/printers",
                        "/print/status",
                        "/print/test",
                        "/print",
                        "/print/html",
                        "/cash-drawer/open"
                    }
                }
            }, corsOrigin);
        }

        if (string.Equals(request.Method, "GET", StringComparison.OrdinalIgnoreCase) && request.Path == "/printers")
        {
            if (!IsAuthorizedBridgeRequest(request)) return Unauthorized(corsOrigin);
            return HttpResponseData.Json(200, BuildPrintersPayload(), corsOrigin);
        }

        if (string.Equals(request.Method, "POST", StringComparison.OrdinalIgnoreCase) && request.Path == "/print/test")
        {
            if (!IsAuthorizedBridgeRequest(request)) return Unauthorized(corsOrigin);
            return await HandleTestPrintAsync(request, corsOrigin, cancellationToken).ConfigureAwait(false);
        }

        if (string.Equals(request.Method, "POST", StringComparison.OrdinalIgnoreCase) && request.Path == "/cash-drawer/open")
        {
            if (!IsAuthorizedBridgeRequest(request)) return Unauthorized(corsOrigin);
            return await HandleCashDrawerOpenAsync(request, corsOrigin, cancellationToken).ConfigureAwait(false);
        }

        if (string.Equals(request.Method, "POST", StringComparison.OrdinalIgnoreCase) &&
            (request.Path == "/print" || request.Path == "/api/print" || request.Path == "/print/html"))
        {
            if (!IsAuthorizedBridgeRequest(request)) return Unauthorized(corsOrigin);
            return await HandlePrintAsync(request, corsOrigin, cancellationToken).ConfigureAwait(false);
        }

        return HttpResponseData.Json(404, new
        {
            ok = false,
            error = new { code = "not_found", message = "Use GET /health, GET /printers, POST /print/test, POST /print, or POST /cash-drawer/open." }
        }, corsOrigin);
    }

    private static HttpResponseData Unauthorized(string? corsOrigin)
    {
        return HttpResponseData.Json(401, new
        {
            ok = false,
            error = new { code = "bridge_token_required", message = "Missing or invalid CpIPOS bridge token." }
        }, corsOrigin);
    }

    private bool IsAuthorizedBridgeRequest(HttpRequestData request)
    {
        var provided = request.Header("X-CpIPOS-Bridge-Token") ?? request.Header("X-Cpipos-Bridge-Token");
        if (string.IsNullOrWhiteSpace(provided) || string.IsNullOrWhiteSpace(_bridgeToken)) return false;
        var providedBytes = Encoding.UTF8.GetBytes(provided.Trim());
        var expectedBytes = Encoding.UTF8.GetBytes(_bridgeToken);
        return providedBytes.Length == expectedBytes.Length && CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }

    private static string? ResolveCorsOrigin(HttpRequestData? request)
    {
        var origin = request?.Header("Origin");
        if (string.IsNullOrWhiteSpace(origin)) return null;
        return AllowedOrigins.Contains(origin.Trim()) ? origin.Trim() : string.Empty;
    }

    private object BuildHealthPayload()
    {
        var printers = GetInstalledPrinterNames();
        var resolved = ResolvePrinterNameOrNull(_defaultPrinter, printers);
        var defaultPrinter = GetSystemDefaultPrinter();

        return new
        {
            ok = true,
            data = new
            {
                status = IsRunning ? "online" : "bridge_not_started",
                app = "CpIPOS Windows Native Runtime",
                provider = "native_dotnet_print_bridge",
                bridge_version = Version,
                token_required = true,
                host = "127.0.0.1",
                port = _port,
                started_at = _startedAt,
                uptime_seconds = Math.Max(0, (int)(DateTimeOffset.Now - _startedAt).TotalSeconds),
                configured_printer = string.IsNullOrWhiteSpace(_defaultPrinter) ? null : _defaultPrinter,
                system_default_printer = defaultPrinter,
                resolved_printer = resolved,
                selected_printer_valid = !string.IsNullOrWhiteSpace(resolved),
                installed_printer_count = printers.Length,
                print_queue_busy = _printLock.CurrentCount == 0,
                drawer_queue_busy = _drawerLock.CurrentCount == 0,
                request_slots_available = _requestSlots.CurrentCount,
                supports_cash_drawer = true,
                supports_external_serial_drawer_controller = true,
                supports_external_network_drawer_controller = true,
                printed_jobs = _printedJobs,
                drawer_commands = _drawerCommands,
                failed_jobs = _failedJobs,
                last_print_at = _lastPrintAt,
                last_drawer_at = _lastDrawerAt,
                last_printer = _lastPrinter,
                last_drawer_device = _lastDrawerDevice,
                last_error = _lastError,
                time = DateTimeOffset.Now
            }
        };
    }

    private object BuildPrintersPayload()
    {
        var names = GetInstalledPrinterNames();
        var defaultPrinter = GetSystemDefaultPrinter();
        var resolved = ResolvePrinterNameOrNull(_defaultPrinter, names);

        return new
        {
            ok = true,
            data = new
            {
                default_printer = defaultPrinter,
                configured_printer = string.IsNullOrWhiteSpace(_defaultPrinter) ? null : _defaultPrinter,
                resolved_printer = resolved,
                printers = names.Select(name => new
                {
                    name,
                    is_default = string.Equals(name, defaultPrinter, StringComparison.OrdinalIgnoreCase),
                    is_configured = string.Equals(name, resolved, StringComparison.OrdinalIgnoreCase),
                    is_valid = IsPrinterValid(name)
                }).ToArray()
            }
        };
    }

    private async Task<HttpResponseData> HandleTestPrintAsync(HttpRequestData request, string? corsOrigin, CancellationToken cancellationToken)
    {
        try
        {
            var printerName = _defaultPrinter;
            if (!string.IsNullOrWhiteSpace(request.Body))
            {
                using var document = JsonDocument.Parse(request.Body);
                printerName = FirstString(document.RootElement, "printer_name", "printerName", "windows_printer", "printer") ?? _defaultPrinter;
            }

            var result = await PrintTextAsync(BuildTestReceipt(), printerName, cancellationToken).ConfigureAwait(false);
            return HttpResponseData.Json(200, new
            {
                ok = true,
                data = new
                {
                    printed = true,
                    provider = "native_dotnet_print_document",
                    bridge_version = Version,
                    printer_name = result.PrinterName,
                    job_id = result.JobId
                }
            }, corsOrigin);
        }
        catch (Exception ex)
        {
            _failedJobs++;
            _lastError = ex.Message;
            return HttpResponseData.Json(500, new
            {
                ok = false,
                error = new { code = "print_test_failed", message = ex.Message },
                data = new { bridge_version = Version, health = BuildHealthPayload() }
            }, corsOrigin);
        }
    }

    private async Task<HttpResponseData> HandleCashDrawerOpenAsync(HttpRequestData request, string? corsOrigin, CancellationToken cancellationToken)
    {
        try
        {
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(request.Body) ? "{}" : request.Body);
            var command = CashDrawerCommand.FromJson(_defaultPrinter, document.RootElement);
            var result = await OpenCashDrawerAsync(command, cancellationToken).ConfigureAwait(false);
            return HttpResponseData.Json(200, new
            {
                ok = true,
                data = new
                {
                    opened = true,
                    provider = result.Provider,
                    bridge_version = Version,
                    connection_mode = result.ConnectionMode,
                    device_name = result.DeviceName,
                    printer_name = result.DeviceName,
                    job_id = result.JobId,
                    bytes_sent = result.BytesSent,
                    kick_pin = result.KickPin,
                    pulse_on_ms = result.PulseOnMs,
                    pulse_off_ms = result.PulseOffMs
                }
            }, corsOrigin);
        }
        catch (Exception ex)
        {
            _failedJobs++;
            _lastError = ex.Message;
            return HttpResponseData.Json(500, new
            {
                ok = false,
                error = new { code = "cash_drawer_open_failed", message = ex.Message },
                data = new { bridge_version = Version, health = BuildHealthPayload() }
            }, corsOrigin);
        }
    }

    private async Task<HttpResponseData> HandlePrintAsync(HttpRequestData request, string? corsOrigin, CancellationToken cancellationToken)
    {
        try
        {
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(request.Body) ? "{}" : request.Body);
            var root = document.RootElement;
            if (IsCashDrawerCommand(root))
            {
                return await HandleCashDrawerOpenAsync(request, corsOrigin, cancellationToken).ConfigureAwait(false);
            }

            var printerName = FirstString(root, "printer_name", "printerName", "windows_printer", "printer") ?? _defaultPrinter;
            var html = ExtractPrintableHtml(root);

            if (!string.IsNullOrWhiteSpace(html))
            {
                var htmlResult = await PrintHtmlAsync(html, printerName, cancellationToken).ConfigureAwait(false);
                return HttpResponseData.Json(200, new
                {
                    ok = true,
                    data = new
                    {
                        printed = true,
                        provider = "native_winforms_html_receipt",
                        printer_name = htmlResult.PrinterName,
                        job_id = htmlResult.JobId,
                        html_printed = true,
                        bridge_version = Version
                    }
                }, corsOrigin);
            }

            var text = ExtractPrintableText(root);

            if (string.IsNullOrWhiteSpace(text))
            {
                return HttpResponseData.Json(400, new
                {
                    ok = false,
                    error = new { code = "empty_print_payload", message = "No printable text/html found." }
                }, corsOrigin);
            }

            var result = await PrintTextAsync(text, printerName, cancellationToken).ConfigureAwait(false);
            return HttpResponseData.Json(200, new
            {
                ok = true,
                data = new
                {
                    printed = true,
                    provider = "native_dotnet_print_document",
                    printer_name = result.PrinterName,
                    job_id = result.JobId,
                    chars_printed = text.Length,
                    bridge_version = Version
                }
            }, corsOrigin);
        }
        catch (Exception ex)
        {
            _failedJobs++;
            _lastError = ex.Message;
            return HttpResponseData.Json(500, new
            {
                ok = false,
                error = new { code = "print_failed", message = ex.Message },
                data = new { bridge_version = Version, health = BuildHealthPayload() }
            }, corsOrigin);
        }
    }
    private async Task<PrintResult> PrintHtmlAsync(string html, string requestedPrinterName, CancellationToken cancellationToken)
    {
        if (!await _printLock.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken).ConfigureAwait(false))
        {
            throw new InvalidOperationException("Print queue is busy. Please retry after the current print job finishes.");
        }

        try
        {
            var installed = GetInstalledPrinterNames();
            var resolvedPrinter = ResolvePrinterNameOrThrow(requestedPrinterName, installed);
            var jobId = "CPIPOS-HTML-" + DateTimeOffset.Now.ToString("yyyyMMddHHmmssfff");
            var htmlToPrint = NormalizeHtmlForReceiptPrint(html);

            using var printTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            printTimeout.CancelAfter(TimeSpan.FromSeconds(25));

            var completion = new TaskCompletionSource<PrintResult>(TaskCreationOptions.RunContinuationsAsynchronously);
            using var registration = printTimeout.Token.Register(() =>
            {
                completion.TrySetException(new TimeoutException("HTML receipt print timed out."));
            });

            var printThread = new Thread(() =>
            {
                string? originalDefaultPrinter = null;
                var defaultPrinterChanged = false;
                System.Windows.Forms.ApplicationContext? context = null;
                System.Windows.Forms.WebBrowser? browser = null;
                System.Windows.Forms.Timer? timeoutTimer = null;

                void Finish(Exception? error)
                {
                    try { timeoutTimer?.Stop(); } catch { }

                    try
                    {
                        if (defaultPrinterChanged && !string.IsNullOrWhiteSpace(originalDefaultPrinter))
                        {
                            SetDefaultPrinter(originalDefaultPrinter);
                        }
                    }
                    catch
                    {
                        // Restoring default printer should not fail the sale.
                    }

                    if (error != null)
                    {
                        completion.TrySetException(error);
                    }
                    else
                    {
                        completion.TrySetResult(new PrintResult(jobId, resolvedPrinter));
                    }

                    try { context?.ExitThread(); } catch { }
                }

                try
                {
                    originalDefaultPrinter = GetSystemDefaultPrinter();

                    if (
                        !string.IsNullOrWhiteSpace(resolvedPrinter) &&
                        !string.Equals(originalDefaultPrinter, resolvedPrinter, StringComparison.OrdinalIgnoreCase)
                    )
                    {
                        defaultPrinterChanged = SetDefaultPrinter(resolvedPrinter);
                    }

                    context = new System.Windows.Forms.ApplicationContext();
                    browser = new System.Windows.Forms.WebBrowser
                    {
                        ScriptErrorsSuppressed = true,
                        ScrollBarsEnabled = false,
                        Width = 420,
                        Height = 1800
                    };

                    timeoutTimer = new System.Windows.Forms.Timer { Interval = 12000 };
                    timeoutTimer.Tick += (_, _) =>
                    {
                        Finish(new TimeoutException("HTML receipt render timed out."));
                    };

                    browser.DocumentCompleted += (_, _) =>
                    {
                        if (browser.ReadyState != System.Windows.Forms.WebBrowserReadyState.Complete)
                        {
                            return;
                        }

                        try
                        {
                            timeoutTimer.Stop();
                            browser.Print();
                            Finish(null);
                        }
                        catch (Exception printError)
                        {
                            Finish(printError);
                        }
                    };

                    timeoutTimer.Start();
                    browser.DocumentText = htmlToPrint;
                    System.Windows.Forms.Application.Run(context);
                }
                catch (Exception error)
                {
                    Finish(error);
                }
                finally
                {
                    try { timeoutTimer?.Dispose(); } catch { }
                    try { browser?.Dispose(); } catch { }
                }
            });

            printThread.IsBackground = true;
            printThread.SetApartmentState(ApartmentState.STA);
            printThread.Start();

            var result = await completion.Task.ConfigureAwait(false);

            _printedJobs++;
            _lastError = null;
            _lastPrintAt = DateTimeOffset.Now;
            _lastPrinter = resolvedPrinter;
            return result;
        }
        finally
        {
            _printLock.Release();
        }
    }

    private static string NormalizeHtmlForReceiptPrint(string html)
    {
        var trimmed = html.Trim();
        var normalized = trimmed.Contains("<html", StringComparison.OrdinalIgnoreCase)
            ? trimmed
            : "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>" + trimmed + "</body></html>";

        const string runtimeStyle = """
<style id="cpipos-runtime-html-receipt-print">
@page { margin: 0; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  color: #000 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
img { max-width: 100%; }
</style>
""";

        if (normalized.Contains("cpipos-runtime-html-receipt-print", StringComparison.OrdinalIgnoreCase))
        {
            return normalized;
        }

        if (Regex.IsMatch(normalized, "</head>", RegexOptions.IgnoreCase))
        {
            return Regex.Replace(normalized, "</head>", runtimeStyle + "</head>", RegexOptions.IgnoreCase);
        }

        return runtimeStyle + normalized;
    }
    private async Task<PrintResult> PrintTextAsync(string text, string requestedPrinterName, CancellationToken cancellationToken)
    {
        if (!await _printLock.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken).ConfigureAwait(false))
        {
            throw new InvalidOperationException("Print queue is busy. Please retry after the current print job finishes.");
        }

        try
        {
            var installed = GetInstalledPrinterNames();
            var resolvedPrinter = ResolvePrinterNameOrThrow(requestedPrinterName, installed);
            var jobId = "CPIPOS-" + DateTimeOffset.Now.ToString("yyyyMMddHHmmssfff");

            using var printTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            printTimeout.CancelAfter(TimeSpan.FromSeconds(45));

            await Task.Run(() =>
            {
                printTimeout.Token.ThrowIfCancellationRequested();

                using var font = new Font("Tahoma", 9, FontStyle.Regular, GraphicsUnit.Point);
                using var document = new PrintDocument
                {
                    DocumentName = jobId,
                    PrintController = new StandardPrintController()
                };

                document.PrinterSettings.PrinterName = resolvedPrinter;
                document.OriginAtMargins = false;
                document.DefaultPageSettings.Margins = new Margins(2, 2, 2, 2);

                if (!document.PrinterSettings.IsValid)
                {
                    throw new InvalidOperationException($"Printer not found or not ready: {resolvedPrinter}");
                }

                var remainingText = text;
                document.PrintPage += (_, eventArgs) =>
                {
                    printTimeout.Token.ThrowIfCancellationRequested();
                    var bounds = eventArgs.MarginBounds;
                    if (bounds.Width <= 0 || bounds.Height <= 0)
                    {
                        bounds = new Rectangle(2, 2, Math.Max(1, eventArgs.PageBounds.Width - 4), Math.Max(1, eventArgs.PageBounds.Height - 4));
                    }

                    var layout = new RectangleF(bounds.Left, bounds.Top, bounds.Width, bounds.Height);
                    var measureSize = new SizeF(Math.Max(1, bounds.Width), Math.Max(1, bounds.Height));
                    int charsFitted;
                    int linesFilled;
                    eventArgs.Graphics.MeasureString(remainingText, font, measureSize, StringFormat.GenericTypographic, out charsFitted, out linesFilled);

                    if (charsFitted <= 0 || charsFitted >= remainingText.Length)
                    {
                        eventArgs.Graphics.DrawString(remainingText, font, Brushes.Black, layout);
                        eventArgs.HasMorePages = false;
                        remainingText = string.Empty;
                    }
                    else
                    {
                        var pageText = remainingText[..charsFitted];
                        eventArgs.Graphics.DrawString(pageText, font, Brushes.Black, layout);
                        remainingText = remainingText[charsFitted..].TrimStart('\r', '\n');
                        eventArgs.HasMorePages = remainingText.Length > 0;
                    }
                };

                document.Print();
            }, printTimeout.Token).ConfigureAwait(false);

            _printedJobs++;
            _lastError = null;
            _lastPrintAt = DateTimeOffset.Now;
            _lastPrinter = resolvedPrinter;
            return new PrintResult(jobId, resolvedPrinter);
        }
        finally
        {
            _printLock.Release();
        }
    }

    private async Task<CashDrawerResult> OpenCashDrawerAsync(CashDrawerCommand command, CancellationToken cancellationToken)
    {
        if (!await _drawerLock.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken).ConfigureAwait(false))
        {
            throw new InvalidOperationException("Cash drawer queue is busy. Please retry after the current drawer command finishes.");
        }

        try
        {
            var normalizedMode = NormalizeMode(command.ConnectionMode);
            var result = normalizedMode switch
            {
                "printer-kick" or "emergency-printer-kick" => await OpenPrinterKickDrawerAsync(command, normalizedMode, cancellationToken).ConfigureAwait(false),
                "external-serial-controller" => await OpenSerialDrawerControllerAsync(command, normalizedMode, cancellationToken).ConfigureAwait(false),
                "external-network-controller" => await OpenNetworkDrawerControllerAsync(command, normalizedMode, cancellationToken).ConfigureAwait(false),
                "external-usb-controller" => await OpenUsbDrawerControllerAsync(command, normalizedMode, cancellationToken).ConfigureAwait(false),
                "vendor-sdk" => throw new NotSupportedException("vendor-sdk drawer controller mode requires a vendor-specific Windows adapter and is not enabled in this runtime yet."),
                _ => await OpenPrinterKickDrawerAsync(command, "printer-kick", cancellationToken).ConfigureAwait(false)
            };

            _drawerCommands++;
            _lastError = null;
            _lastDrawerAt = DateTimeOffset.Now;
            _lastDrawerDevice = result.DeviceName;
            return result;
        }
        finally
        {
            _drawerLock.Release();
        }
    }

    private async Task<CashDrawerResult> OpenPrinterKickDrawerAsync(CashDrawerCommand command, string connectionMode, CancellationToken cancellationToken)
    {
        var installed = GetInstalledPrinterNames();
        var resolvedPrinter = ResolvePrinterNameOrThrow(command.PrinterName, installed);
        var jobId = "CPIPOS-DRAWER-" + DateTimeOffset.Now.ToString("yyyyMMddHHmmssfff");
        var bytes = command.CommandBytes();
        await Task.Run(() => RawPrinterWriter.SendBytes(resolvedPrinter, jobId, bytes), cancellationToken).ConfigureAwait(false);
        return new CashDrawerResult(jobId, "windows_raw_escpos_cash_drawer", resolvedPrinter, connectionMode, command.KickPin, command.PulseOnMs, command.PulseOffMs, bytes.Length);
    }

    private async Task<CashDrawerResult> OpenSerialDrawerControllerAsync(CashDrawerCommand command, string connectionMode, CancellationToken cancellationToken)
    {
        var port = command.ControllerPort?.Trim();
        if (string.IsNullOrWhiteSpace(port))
        {
            throw new InvalidOperationException("external-serial-controller requires drawer_controller_port, serial_port, or com_port metadata such as COM3.");
        }

        var devicePath = NormalizeComPortPath(port);
        var jobId = "CPIPOS-DRAWER-SERIAL-" + DateTimeOffset.Now.ToString("yyyyMMddHHmmssfff");
        var bytes = command.CommandBytes();
        await using var stream = new FileStream(devicePath, FileMode.Open, FileAccess.Write, FileShare.None, 0, FileOptions.Asynchronous);
        await stream.WriteAsync(bytes.AsMemory(0, bytes.Length), cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        return new CashDrawerResult(jobId, "windows_com_raw_cash_drawer_controller", port, connectionMode, command.KickPin, command.PulseOnMs, command.PulseOffMs, bytes.Length);
    }

    private async Task<CashDrawerResult> OpenNetworkDrawerControllerAsync(CashDrawerCommand command, string connectionMode, CancellationToken cancellationToken)
    {
        var bytes = command.CommandBytes();
        var jobId = "CPIPOS-DRAWER-NET-" + DateTimeOffset.Now.ToString("yyyyMMddHHmmssfff");
        var url = command.ControllerUrl?.Trim();

        if (!string.IsNullOrWhiteSpace(url) && (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            using var content = new ByteArrayContent(bytes);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            using var response = await client.PostAsync(url, content, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Network drawer HTTP controller returned {(int)response.StatusCode} {response.ReasonPhrase}.");
            }
            return new CashDrawerResult(jobId, "http_cash_drawer_controller", url, connectionMode, command.KickPin, command.PulseOnMs, command.PulseOffMs, bytes.Length);
        }

        var (host, port) = ResolveNetworkEndpoint(command);
        using var tcp = new TcpClient();
        await tcp.ConnectAsync(host, port, cancellationToken).ConfigureAwait(false);
        await using var stream = tcp.GetStream();
        await stream.WriteAsync(bytes.AsMemory(0, bytes.Length), cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        return new CashDrawerResult(jobId, "tcp_cash_drawer_controller", $"{host}:{port}", connectionMode, command.KickPin, command.PulseOnMs, command.PulseOffMs, bytes.Length);
    }

    private async Task<CashDrawerResult> OpenUsbDrawerControllerAsync(CashDrawerCommand command, string connectionMode, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(command.ControllerPort) && command.ControllerPort.Trim().StartsWith("COM", StringComparison.OrdinalIgnoreCase))
        {
            return await OpenSerialDrawerControllerAsync(command, "external-usb-controller", cancellationToken).ConfigureAwait(false);
        }
        throw new NotSupportedException("external-usb-controller requires a COM-compatible USB trigger in this runtime. Native HID/vendor USB drawer triggers need a vendor SDK adapter.");
    }

    private static (string host, int port) ResolveNetworkEndpoint(CashDrawerCommand command)
    {
        if (!string.IsNullOrWhiteSpace(command.ControllerUrl))
        {
            var raw = command.ControllerUrl.Trim();
            if (raw.StartsWith("tcp://", StringComparison.OrdinalIgnoreCase))
            {
                var uri = new Uri(raw);
                if (!string.IsNullOrWhiteSpace(uri.Host) && uri.Port > 0) return (uri.Host, uri.Port);
            }
            var parts = raw.Split(':', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (parts.Length == 2 && int.TryParse(parts[1], out var parsedPort)) return (parts[0], parsedPort);
        }

        if (!string.IsNullOrWhiteSpace(command.ControllerHost) && command.ControllerTcpPort is > 0)
        {
            return (command.ControllerHost.Trim(), command.ControllerTcpPort.Value);
        }

        throw new InvalidOperationException("external-network-controller requires drawer_controller_url such as tcp://192.168.1.50:9100, or drawer_controller_host plus drawer_controller_tcp_port.");
    }

    private static string NormalizeComPortPath(string port)
    {
        var trimmed = port.Trim();
        if (trimmed.StartsWith("\\\\.\\", StringComparison.OrdinalIgnoreCase)) return trimmed;
        if (!Regex.IsMatch(trimmed, "^COM\\d+$", RegexOptions.IgnoreCase))
        {
            throw new InvalidOperationException($"Invalid serial drawer controller port: {port}. Expected COM3, COM5, etc.");
        }
        return "\\\\.\\" + trimmed.ToUpperInvariant();
    }

    private static string NormalizeMode(string? mode)
    {
        var normalized = (mode ?? "printer-kick").Trim().ToLowerInvariant().Replace('_', '-');
        return normalized switch
        {
            "printer" or "printerkick" or "printer-kick" => "printer-kick",
            "emergency" or "emergency-printer" or "emergency-printer-kick" => "emergency-printer-kick",
            "serial" or "com" or "external-serial" or "external-serial-controller" => "external-serial-controller",
            "network" or "tcp" or "lan" or "external-network" or "external-network-controller" => "external-network-controller",
            "usb" or "external-usb" or "external-usb-controller" => "external-usb-controller",
            "vendor" or "sdk" or "vendor-sdk" => "vendor-sdk",
            _ => "printer-kick"
        };
    }

    private static string[] GetInstalledPrinterNames()
    {
        try
        {
            return PrinterSettings.InstalledPrinters.Cast<string>()
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static string ResolvePrinterNameOrNull(string requestedPrinterName, string[] installed)
    {
        try
        {
            return ResolvePrinterNameOrThrow(requestedPrinterName, installed);
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string ResolvePrinterNameOrThrow(string requestedPrinterName, string[] installed)
    {
        if (!string.IsNullOrWhiteSpace(requestedPrinterName))
        {
            var match = installed.FirstOrDefault(name => string.Equals(name, requestedPrinterName.Trim(), StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(match)) return match;

            throw new InvalidOperationException($"Printer is not installed on this Windows machine: {requestedPrinterName}. Installed printers: {string.Join(", ", installed)}");
        }

        var defaultPrinter = GetSystemDefaultPrinter();
        if (!string.IsNullOrWhiteSpace(defaultPrinter)) return defaultPrinter;

        throw new InvalidOperationException("No Windows default printer found. Please install or select a Windows printer first.");
    }

    private static bool IsPrinterValid(string printerName)
    {
        try
        {
            using var document = new PrintDocument();
            document.PrinterSettings.PrinterName = printerName;
            return document.PrinterSettings.IsValid;
        }
        catch
        {
            return false;
        }
    }

    private static string? GetSystemDefaultPrinter()
    {
        try
        {
            var settings = new PrinterSettings();
            return string.IsNullOrWhiteSpace(settings.PrinterName) ? null : settings.PrinterName;
        }
        catch
        {
            return null;
        }
    }

    private static string BuildTestReceipt()
    {
        return string.Join("\r\n", new[]
        {
            "CpIPOS",
            "ทดสอบพิมพ์ผ่าน CpIPOS สำหรับ Windows",
            "------------------------------",
            "Local Bridge: 127.0.0.1",
            "Provider: .NET PrintDocument",
            "Cash drawer: printer, emergency, serial, and network controller modes",
            "เวลา: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            "------------------------------",
            "ขอบคุณครับ",
            string.Empty,
            string.Empty
        });
    }

    private static bool IsCashDrawerCommand(JsonElement root)
    {
        var action = FirstString(root, "action", "command");
        if (IsDrawerCommandValue(action)) return true;

        var metadata = GetObject(root, "metadata");
        if (IsDrawerCommandValue(FirstString(metadata, "action", "command"))) return true;

        var payloadJson = GetObject(root, "payload_json");
        if (IsDrawerCommandValue(FirstString(payloadJson, "action", "command"))) return true;

        var text = FirstString(root, "text", "payload_text", "receipt_text", "content");
        return IsDrawerCommandValue(text);
    }

    private static bool IsDrawerCommandValue(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().Trim('\0').ToLowerInvariant().Replace('-', '_');
        if (normalized.Length == 0) return false;
        if (normalized is "open_cash_drawer" or "cash_drawer_open" or "open_cashdrawer" or "drawer_open") return true;

        var tokenized = Regex.Replace(normalized, @"[\s\p{P}\p{C}]+", " ").Trim();
        return tokenized is "open cash drawer" or "cash drawer open" or "open drawer";
    }

    private static string? ExtractPrintableHtml(JsonElement root)
    {
        var metadata = GetObject(root, "metadata");
        var payloadJson = GetObject(root, "payload_json");

        return FirstString(root, "html", "payload_html", "receipt_html")
               ?? FirstString(metadata, "payload_html", "receipt_html")
               ?? FirstString(payloadJson, "payload_html", "receipt_html");
    }

    private static string ExtractPrintableText(JsonElement root)
    {
        var text = FirstString(root, "text", "payload_text", "receipt_text", "content");
        if (!string.IsNullOrWhiteSpace(text)) return NormalizeLines(text);

        var metadata = GetObject(root, "metadata");
        text = FirstString(metadata, "payload_text", "receipt_text");
        if (!string.IsNullOrWhiteSpace(text)) return NormalizeLines(text);

        var payloadJson = GetObject(root, "payload_json");
        text = FirstString(payloadJson, "payload_text", "receipt_text");
        if (!string.IsNullOrWhiteSpace(text)) return NormalizeLines(text);

        var html = FirstString(root, "html", "payload_html", "receipt_html")
                   ?? FirstString(metadata, "payload_html", "receipt_html")
                   ?? FirstString(payloadJson, "payload_html", "receipt_html");
        if (!string.IsNullOrWhiteSpace(html)) return StripHtml(html);

        return BuildTextFromItems(root);
    }

    private static string BuildTextFromItems(JsonElement root)
    {
        var lines = new List<string>();
        var title = FirstString(root, "title", "store_name") ?? "CpIPOS";
        var orderNo = FirstString(root, "order_no", "orderNo");
        lines.Add(title);
        if (!string.IsNullOrWhiteSpace(orderNo)) lines.Add("เลขที่บิล " + orderNo);
        lines.Add("------------------------------");

        if (root.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in items.EnumerateArray())
            {
                var name = FirstString(item, "name", "product_name", "label") ?? "รายการ";
                var qty = FirstString(item, "qty", "quantity") ?? "1";
                var total = FirstString(item, "total", "line_total", "price") ?? string.Empty;
                lines.Add($"{name} x{qty}{(total.Length > 0 ? "  " + total : string.Empty)}");
            }
        }

        var grandTotal = FirstString(root, "total", "total_amount", "grand_total");
        if (!string.IsNullOrWhiteSpace(grandTotal))
        {
            lines.Add("------------------------------");
            lines.Add("ยอดรวม " + grandTotal);
        }

        lines.Add(string.Empty);
        lines.Add(string.Empty);
        return string.Join("\r\n", lines);
    }

    private static JsonElement GetObject(JsonElement root, string name)
    {
        return root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : default;
    }

    private static string? FirstString(JsonElement root, params string[] names)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        foreach (var name in names)
        {
            if (!root.TryGetProperty(name, out var value)) continue;
            var text = value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.ToString(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => null
            };
            if (!string.IsNullOrWhiteSpace(text)) return text.Trim();
        }
        return null;
    }

    private static int? ReadInt(JsonElement root, params string[] names)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        foreach (var name in names)
        {
            if (!root.TryGetProperty(name, out var value)) continue;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
            if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number)) return number;
        }
        return null;
    }

    private static string NormalizeLines(string value)
    {
        return value.Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", "\r\n");
    }

    private static string StripHtml(string html)
    {
        var value = Regex.Replace(html, "<script[\\s\\S]*?</script>", " ", RegexOptions.IgnoreCase);
        value = Regex.Replace(value, "<style[\\s\\S]*?</style>", " ", RegexOptions.IgnoreCase);
        value = Regex.Replace(value, "<(br|hr)\\s*/?>", "\n", RegexOptions.IgnoreCase);
        value = Regex.Replace(value, "</(p|div|h1|h2|h3|tr|table|section|article|main|header|footer|li)>", "\n", RegexOptions.IgnoreCase);
        value = Regex.Replace(value, "<[^>]+>", " ");
        value = WebUtility.HtmlDecode(value);
        var lines = value.Split('\n')
            .Select(line => Regex.Replace(line, "\\s+", " ").Trim())
            .Where(line => line.Length > 0);
        return string.Join("\r\n", lines);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        IsRunning = false;
        try { _stopping.Cancel(); } catch { }
        try { _listener?.Stop(); } catch { }
        _printLock.Dispose();
        _drawerLock.Dispose();
        _requestSlots.Dispose();
        _stopping.Dispose();
    }

    private sealed record PrintResult(string JobId, string PrinterName);
    private sealed record CashDrawerResult(string JobId, string Provider, string DeviceName, string ConnectionMode, int KickPin, int PulseOnMs, int PulseOffMs, int BytesSent);

    private sealed record CashDrawerCommand(
        string PrinterName,
        string? ConnectionMode,
        string? ControllerPort,
        string? ControllerUrl,
        string? ControllerHost,
        int? ControllerTcpPort,
        string? CommandHex,
        string? CommandText,
        int KickPin,
        int PulseOnMs,
        int PulseOffMs)
    {
        public static CashDrawerCommand FromJson(string defaultPrinter, JsonElement root)
        {
            var metadata = GetObject(root, "metadata");
            var printerName = FirstString(root, "printer_name", "printerName", "windows_printer", "printer")
                              ?? FirstString(metadata, "printer_name", "printerName", "windows_printer", "printer")
                              ?? defaultPrinter;
            var mode = FirstString(root, "drawer_connection_mode", "connection_mode", "mode")
                       ?? FirstString(metadata, "drawer_connection_mode", "connection_mode", "mode")
                       ?? "printer-kick";
            var controllerPort = FirstString(root, "drawer_controller_port", "controller_port", "serial_port", "com_port", "port_name")
                                 ?? FirstString(metadata, "drawer_controller_port", "controller_port", "serial_port", "com_port", "port_name");
            var controllerUrl = FirstString(root, "drawer_controller_url", "controller_url", "url")
                                ?? FirstString(metadata, "drawer_controller_url", "controller_url", "url");
            var controllerHost = FirstString(root, "drawer_controller_host", "controller_host", "host", "ip_address")
                                 ?? FirstString(metadata, "drawer_controller_host", "controller_host", "host", "ip_address");
            var controllerTcpPort = ReadInt(root, "drawer_controller_tcp_port", "controller_tcp_port", "tcp_port", "port")
                                    ?? ReadInt(metadata, "drawer_controller_tcp_port", "controller_tcp_port", "tcp_port", "port");
            var commandHex = FirstString(root, "drawer_command_hex", "command_hex", "open_command_hex")
                             ?? FirstString(metadata, "drawer_command_hex", "command_hex", "open_command_hex");
            var commandText = FirstString(root, "drawer_command_text", "command_text", "open_command_text")
                              ?? FirstString(metadata, "drawer_command_text", "command_text", "open_command_text");
            var kickPin = ReadInt(root, "drawer_kick_pin", "kick_pin", "pin") ?? ReadInt(metadata, "drawer_kick_pin", "kick_pin", "pin") ?? 0;
            var pulseOnMs = ReadInt(root, "drawer_pulse_on_ms", "pulse_on_ms") ?? ReadInt(metadata, "drawer_pulse_on_ms", "pulse_on_ms") ?? 50;
            var pulseOffMs = ReadInt(root, "drawer_pulse_off_ms", "pulse_off_ms") ?? ReadInt(metadata, "drawer_pulse_off_ms", "pulse_off_ms") ?? 250;

            return new CashDrawerCommand(
                printerName,
                mode,
                controllerPort,
                controllerUrl,
                controllerHost,
                controllerTcpPort,
                commandHex,
                commandText,
                Math.Clamp(kickPin, 0, 1),
                Math.Clamp(pulseOnMs, 20, 500),
                Math.Clamp(pulseOffMs, 20, 500));
        }

        public byte[] CommandBytes()
        {
            if (!string.IsNullOrWhiteSpace(CommandHex)) return ParseHexBytes(CommandHex);
            if (!string.IsNullOrEmpty(CommandText)) return Encoding.ASCII.GetBytes(CommandText);
            var onUnits = Math.Clamp((int)Math.Round(PulseOnMs / 2.0), 1, 255);
            var offUnits = Math.Clamp((int)Math.Round(PulseOffMs / 2.0), 1, 255);
            return new byte[] { 0x1b, 0x40, 0x1b, 0x70, (byte)KickPin, (byte)onUnits, (byte)offUnits };
        }

        private static byte[] ParseHexBytes(string value)
        {
            var compact = Regex.Replace(value, @"[^0-9a-fA-F]", string.Empty);
            if (compact.Length == 0 || compact.Length % 2 != 0) throw new InvalidOperationException("drawer_command_hex must contain an even number of hex digits.");
            var bytes = new byte[compact.Length / 2];
            for (var i = 0; i < bytes.Length; i++)
            {
                bytes[i] = Convert.ToByte(compact.Substring(i * 2, 2), 16);
            }
            return bytes;
        }
    }
}

internal static class RawPrinterWriter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DOC_INFO_1
    {
        public string pDocName;
        public string? pOutputFile;
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOC_INFO_1 pDocInfo);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static void SendBytes(string printerName, string documentName, byte[] bytes)
    {
        if (bytes.Length == 0) throw new InvalidOperationException("No raw printer bytes to send.");
        if (!OpenPrinter(printerName, out var handle, IntPtr.Zero))
        {
            throw new InvalidOperationException($"Cannot open Windows printer for raw output: {printerName}. Win32={Marshal.GetLastWin32Error()}");
        }

        try
        {
            var document = new DOC_INFO_1
            {
                pDocName = documentName,
                pOutputFile = null,
                pDataType = "RAW"
            };
            if (StartDocPrinter(handle, 1, ref document) == 0)
            {
                throw new InvalidOperationException($"Cannot start raw print document. Win32={Marshal.GetLastWin32Error()}");
            }

            try
            {
                if (!StartPagePrinter(handle))
                {
                    throw new InvalidOperationException($"Cannot start raw print page. Win32={Marshal.GetLastWin32Error()}");
                }

                try
                {
                    if (!WritePrinter(handle, bytes, bytes.Length, out var written) || written != bytes.Length)
                    {
                        throw new InvalidOperationException($"Raw printer write failed. Written={written}/{bytes.Length}. Win32={Marshal.GetLastWin32Error()}");
                    }
                }
                finally
                {
                    EndPagePrinter(handle);
                }
            }
            finally
            {
                EndDocPrinter(handle);
            }
        }
        finally
        {
            ClosePrinter(handle);
        }
    }
}

internal sealed class HttpRequestData
{
    private const int MaxHeaderBytes = 1024 * 1024;
    private const int MaxBodyBytes = 3_000_000;

    public string Method { get; init; } = "GET";
    public string Path { get; init; } = "/";
    public string Body { get; init; } = string.Empty;
    public IReadOnlyDictionary<string, string> Headers { get; init; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    public string? Header(string name)
    {
        return Headers.TryGetValue(name, out var value) ? value : null;
    }

    public static async Task<HttpRequestData> ReadAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];
        using var memory = new MemoryStream();
        var headerEnd = -1;

        while (headerEnd < 0)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
            if (read <= 0) break;
            memory.Write(buffer, 0, read);
            headerEnd = FindHeaderEnd(memory.GetBuffer(), (int)memory.Length);
            if (memory.Length > MaxHeaderBytes) throw new InvalidOperationException("request_header_too_large");
        }

        var bytes = memory.ToArray();
        headerEnd = FindHeaderEnd(bytes, bytes.Length);
        if (headerEnd < 0) throw new InvalidOperationException("invalid_http_request");

        var headerText = Encoding.UTF8.GetString(bytes, 0, headerEnd);
        var lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
        var first = lines[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var method = first.Length > 0 ? first[0] : "GET";
        var rawPath = first.Length > 1 ? first[1] : "/";
        var path = rawPath.Split('?')[0];
        var contentLength = 0;
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var line in lines.Skip(1))
        {
            var index = line.IndexOf(':');
            if (index <= 0) continue;
            var key = line[..index].Trim();
            var value = line[(index + 1)..].Trim();
            headers[key] = value;
            if (string.Equals(key, "Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                int.TryParse(value, out contentLength);
            }
        }

        if (contentLength < 0 || contentLength > MaxBodyBytes) throw new InvalidOperationException("payload_too_large");

        var bodyStart = headerEnd + 4;
        using var bodyMemory = new MemoryStream();
        if (bodyStart < bytes.Length)
        {
            var initialBodyLength = Math.Min(contentLength, bytes.Length - bodyStart);
            bodyMemory.Write(bytes, bodyStart, initialBodyLength);
        }

        while (bodyMemory.Length < contentLength)
        {
            var remaining = contentLength - (int)bodyMemory.Length;
            var read = await stream.ReadAsync(buffer.AsMemory(0, Math.Min(buffer.Length, remaining)), cancellationToken).ConfigureAwait(false);
            if (read <= 0) break;
            bodyMemory.Write(buffer, 0, read);
            if (bodyMemory.Length > MaxBodyBytes) throw new InvalidOperationException("payload_too_large");
        }

        var bodyBytes = bodyMemory.ToArray();
        return new HttpRequestData
        {
            Method = method,
            Path = string.IsNullOrWhiteSpace(path) ? "/" : path,
            Body = Encoding.UTF8.GetString(bodyBytes, 0, bodyBytes.Length),
            Headers = headers
        };
    }

    private static int FindHeaderEnd(byte[] bytes, int length)
    {
        for (var i = 0; i <= length - 4; i++)
        {
            if (bytes[i] == '\r' && bytes[i + 1] == '\n' && bytes[i + 2] == '\r' && bytes[i + 3] == '\n') return i;
        }
        return -1;
    }
}

internal sealed class HttpResponseData
{
    private readonly int _status;
    private readonly string _contentType;
    private readonly byte[] _body;
    private readonly string? _corsOrigin;

    private HttpResponseData(int status, string contentType, byte[] body, string? corsOrigin)
    {
        _status = status;
        _contentType = contentType;
        _body = body;
        _corsOrigin = corsOrigin;
    }

    public static HttpResponseData Json(int status, object body, string? corsOrigin)
    {
        return new HttpResponseData(status, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(body), corsOrigin);
    }

    public static HttpResponseData Empty(int status, string? corsOrigin)
    {
        return new HttpResponseData(status, "text/plain; charset=utf-8", Array.Empty<byte>(), corsOrigin);
    }

    public async Task WriteAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var reason = _status switch
        {
            200 => "OK",
            204 => "No Content",
            400 => "Bad Request",
            401 => "Unauthorized",
            404 => "Not Found",
            422 => "Unprocessable Entity",
            429 => "Too Many Requests",
            500 => "Internal Server Error",
            503 => "Service Unavailable",
            504 => "Gateway Timeout",
            _ => "OK"
        };
        var headers = new List<string>
        {
            $"HTTP/1.1 {_status} {reason}",
            "Access-Control-Allow-Methods: GET,POST,OPTIONS",
            "Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CpIPOS-Bridge-Token, X-Cpipos-Bridge-Token",
            "Access-Control-Max-Age: 86400",
            "Cache-Control: no-store",
            $"Content-Type: {_contentType}",
            $"Content-Length: {_body.Length}",
            "Connection: close"
        };

        if (!string.IsNullOrEmpty(_corsOrigin))
        {
            headers.Insert(1, $"Access-Control-Allow-Origin: {_corsOrigin}");
            headers.Insert(2, "Vary: Origin");
            headers.Insert(3, "Access-Control-Allow-Private-Network: true");
        }

        headers.Add(string.Empty);
        headers.Add(string.Empty);
        var header = string.Join("\r\n", headers);
        var headerBytes = Encoding.UTF8.GetBytes(header);
        await stream.WriteAsync(headerBytes.AsMemory(0, headerBytes.Length), cancellationToken).ConfigureAwait(false);
        if (_body.Length > 0)
        {
            await stream.WriteAsync(_body.AsMemory(0, _body.Length), cancellationToken).ConfigureAwait(false);
        }
    }
}



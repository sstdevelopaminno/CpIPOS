using System.Drawing;
using System.Drawing.Printing;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

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
    private readonly SemaphoreSlim _requestSlots = new(16, 16);
    private readonly DateTimeOffset _startedAt = DateTimeOffset.Now;
    private TcpListener? _listener;
    private DateTimeOffset? _lastPrintAt;
    private string? _lastPrinter;
    private string? _lastError;
    private int _printedJobs;
    private int _failedJobs;
    private bool _disposed;

    public string Version => "cpipos-windows-native-bridge-0.1.5";
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
                    await HttpResponseData.Json(503, new
                    {
                        ok = false,
                        error = new { code = "bridge_busy", message = "Local print bridge has too many open requests." }
                    }, null).WriteAsync(stream, bridgeCancellationToken).ConfigureAwait(false);
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
            try
            {
                using (client)
                using (var stream = client.GetStream())
                {
                    await HttpResponseData.Json(504, new
                    {
                        ok = false,
                        error = new { code = "bridge_request_timeout", message = "Local bridge request timed out." }
                    }, ResolveCorsOrigin(request)).WriteAsync(stream, CancellationToken.None).ConfigureAwait(false);
                }
            }
            catch
            {
                // The client may already be gone.
            }
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
            try
            {
                using (client)
                using (var stream = client.GetStream())
                {
                    var response = HttpResponseData.Json(500, new
                    {
                        ok = false,
                        error = new { code = "bridge_unhandled_error", message = ex.Message }
                    }, ResolveCorsOrigin(request));
                    await response.WriteAsync(stream, CancellationToken.None).ConfigureAwait(false);
                }
            }
            catch
            {
                // Avoid throwing from a fire-and-forget connection task.
            }
        }
        finally
        {
            if (slotTaken) _requestSlots.Release();
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
                    supports_print_test = true,
                    supports_list_printers = true,
                    supports_serialized_print_queue = true,
                    supports_cash_drawer = false,
                    supports_offline_sales_engine = false,
                    endpoints = new[] { "/health", "/capabilities", "/printers", "/print/status", "/print/test", "/print" }
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

        if (string.Equals(request.Method, "POST", StringComparison.OrdinalIgnoreCase) &&
            (request.Path == "/print" || request.Path == "/api/print"))
        {
            if (!IsAuthorizedBridgeRequest(request)) return Unauthorized(corsOrigin);
            return await HandlePrintAsync(request, corsOrigin, cancellationToken).ConfigureAwait(false);
        }

        return HttpResponseData.Json(404, new
        {
            ok = false,
            error = new { code = "not_found", message = "Use GET /health, GET /printers, POST /print/test, or POST /print." }
        }, corsOrigin);
    }

    private HttpResponseData Unauthorized(string? corsOrigin)
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
                request_slots_available = _requestSlots.CurrentCount,
                printed_jobs = _printedJobs,
                failed_jobs = _failedJobs,
                last_print_at = _lastPrintAt,
                last_printer = _lastPrinter,
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

    private async Task<HttpResponseData> HandlePrintAsync(HttpRequestData request, string? corsOrigin, CancellationToken cancellationToken)
    {
        try
        {
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(request.Body) ? "{}" : request.Body);
            var root = document.RootElement;
            var printerName = FirstString(root, "printer_name", "printerName", "windows_printer", "printer") ?? _defaultPrinter;
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

                    eventArgs.Graphics.MeasureString(remainingText, font, bounds.Size, StringFormat.GenericTypographic, out var charsFitted, out _);
                    if (charsFitted <= 0 || charsFitted >= remainingText.Length)
                    {
                        eventArgs.Graphics.DrawString(remainingText, font, Brushes.Black, bounds);
                        eventArgs.HasMorePages = false;
                        remainingText = string.Empty;
                    }
                    else
                    {
                        var pageText = remainingText[..charsFitted];
                        eventArgs.Graphics.DrawString(pageText, font, Brushes.Black, bounds);
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
            using var settings = new PrinterSettings();
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
            "เวลา: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            "------------------------------",
            "ขอบคุณครับ",
            "",
            ""
        });
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
        _requestSlots.Dispose();
        _stopping.Dispose();
    }

    private sealed record PrintResult(string JobId, string PrinterName);
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

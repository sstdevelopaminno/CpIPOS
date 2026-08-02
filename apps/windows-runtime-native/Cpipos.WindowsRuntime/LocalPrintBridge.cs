using System.Drawing;
using System.Drawing.Printing;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Cpipos.WindowsRuntime;

internal sealed class LocalPrintBridge : IDisposable
{
    private readonly int _port;
    private readonly string _defaultPrinter;
    private readonly CancellationTokenSource _stopping = new();
    private TcpListener? _listener;

    public string Version => "cpipos-windows-native-bridge-0.1.2";

    public LocalPrintBridge(int port, string defaultPrinter)
    {
        _port = port;
        _defaultPrinter = defaultPrinter;
    }

    public void Start()
    {
        _listener = new TcpListener(IPAddress.Parse("127.0.0.1"), _port);
        _listener.Start();
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
            catch
            {
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

    private async Task HandleClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using (client)
        using (var stream = client.GetStream())
        {
            try
            {
                var request = await HttpRequestData.ReadAsync(stream, cancellationToken).ConfigureAwait(false);
                var response = await RouteAsync(request, cancellationToken).ConfigureAwait(false);
                await response.WriteAsync(stream, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                var response = HttpResponseData.Json(500, new
                {
                    ok = false,
                    error = new { code = "bridge_unhandled_error", message = ex.Message }
                });
                await response.WriteAsync(stream, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private async Task<HttpResponseData> RouteAsync(HttpRequestData request, CancellationToken cancellationToken)
    {
        if (string.Equals(request.Method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
        {
            return HttpResponseData.Empty(204);
        }

        if (string.Equals(request.Method, "GET", StringComparison.OrdinalIgnoreCase) &&
            (request.Path is "/" or "/health" or "/print/health"))
        {
            return HttpResponseData.Json(200, new
            {
                ok = true,
                data = new
                {
                    status = "online",
                    app = "CpIPOS Windows Native Runtime",
                    provider = "native_dotnet_print_bridge",
                    bridge_version = Version,
                    host = "127.0.0.1",
                    port = _port,
                    default_printer = string.IsNullOrWhiteSpace(_defaultPrinter) ? "Windows default" : _defaultPrinter,
                    time = DateTimeOffset.Now
                }
            });
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
                    supports_print_receipt = true,
                    supports_print_test = true,
                    supports_list_printers = true,
                    supports_cash_drawer = false,
                    supports_offline_sales_engine = false,
                    endpoints = new[] { "/health", "/capabilities", "/printers", "/print/test", "/print" }
                }
            });
        }

        if (string.Equals(request.Method, "GET", StringComparison.OrdinalIgnoreCase) && request.Path == "/printers")
        {
            return HttpResponseData.Json(200, new
            {
                ok = true,
                data = new
                {
                    default_printer = string.IsNullOrWhiteSpace(_defaultPrinter) ? GetSystemDefaultPrinter() : _defaultPrinter,
                    printers = PrinterSettings.InstalledPrinters.Cast<string>().Select(name => new { name }).ToArray()
                }
            });
        }

        if (string.Equals(request.Method, "POST", StringComparison.OrdinalIgnoreCase) && request.Path == "/print/test")
        {
            await PrintTextAsync(BuildTestReceipt(), _defaultPrinter, cancellationToken).ConfigureAwait(false);
            return HttpResponseData.Json(200, new
            {
                ok = true,
                data = new { printed = true, provider = "native_dotnet_print_document", bridge_version = Version }
            });
        }

        if (string.Equals(request.Method, "POST", StringComparison.OrdinalIgnoreCase) &&
            (request.Path == "/print" || request.Path == "/api/print"))
        {
            return await HandlePrintAsync(request, cancellationToken).ConfigureAwait(false);
        }

        return HttpResponseData.Json(404, new
        {
            ok = false,
            error = new { code = "not_found", message = "Use GET /health, GET /printers, POST /print/test, or POST /print." }
        });
    }

    private async Task<HttpResponseData> HandlePrintAsync(HttpRequestData request, CancellationToken cancellationToken)
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
            });
        }

        await PrintTextAsync(text, printerName, cancellationToken).ConfigureAwait(false);
        return HttpResponseData.Json(200, new
        {
            ok = true,
            data = new
            {
                printed = true,
                provider = "native_dotnet_print_document",
                printer_name = string.IsNullOrWhiteSpace(printerName) ? "Windows default" : printerName,
                chars_printed = text.Length,
                bridge_version = Version
            }
        });
    }

    private async Task PrintTextAsync(string text, string printerName, CancellationToken cancellationToken)
    {
        await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();

            using var font = new Font("Tahoma", 9, FontStyle.Regular, GraphicsUnit.Point);
            using var document = new PrintDocument
            {
                DocumentName = "CpIPOS Receipt"
            };

            if (!string.IsNullOrWhiteSpace(printerName))
            {
                document.PrinterSettings.PrinterName = printerName;
            }

            if (!document.PrinterSettings.IsValid)
            {
                throw new InvalidOperationException($"Printer not found or not ready: {(string.IsNullOrWhiteSpace(printerName) ? "Windows default" : printerName)}");
            }

            document.PrintPage += (_, eventArgs) =>
            {
                var bounds = new RectangleF(2, 2, eventArgs.PageBounds.Width - 4, eventArgs.PageBounds.Height - 4);
                eventArgs.Graphics.DrawString(text, font, Brushes.Black, bounds);
                eventArgs.HasMorePages = false;
            };

            document.Print();
        }, cancellationToken).ConfigureAwait(false);
    }

    private static string BuildTestReceipt()
    {
        return string.Join("\r\n", new[]
        {
            "CpIPOS Windows Runtime",
            "ทดสอบพิมพ์ผ่านโปรแกรม Windows",
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

    private static string? GetSystemDefaultPrinter()
    {
        try
        {
            var settings = new PrinterSettings();
            return settings.PrinterName;
        }
        catch
        {
            return null;
        }
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
        _stopping.Cancel();
        try { _listener?.Stop(); } catch { }
        _stopping.Dispose();
    }
}

internal sealed class HttpRequestData
{
    private const int MaxHeaderBytes = 1024 * 1024;
    private const int MaxBodyBytes = 3_000_000;

    public string Method { get; init; } = "GET";
    public string Path { get; init; } = "/";
    public string Body { get; init; } = string.Empty;

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
        var first = lines[0].Split(' ');
        var method = first.Length > 0 ? first[0] : "GET";
        var rawPath = first.Length > 1 ? first[1] : "/";
        var path = rawPath.Split('?')[0];
        var contentLength = 0;

        foreach (var line in lines.Skip(1))
        {
            var index = line.IndexOf(':');
            if (index <= 0) continue;
            var key = line[..index].Trim();
            var value = line[(index + 1)..].Trim();
            if (string.Equals(key, "Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                int.TryParse(value, out contentLength);
            }
        }

        var bodyStart = headerEnd + 4;
        var bodyBytes = bytes.Skip(bodyStart).ToArray();
        while (bodyBytes.Length < contentLength)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
            if (read <= 0) break;
            bodyBytes = bodyBytes.Concat(buffer.Take(read)).ToArray();
            if (bodyBytes.Length > MaxBodyBytes) throw new InvalidOperationException("payload_too_large");
        }

        return new HttpRequestData
        {
            Method = method,
            Path = string.IsNullOrWhiteSpace(path) ? "/" : path,
            Body = Encoding.UTF8.GetString(bodyBytes, 0, Math.Min(bodyBytes.Length, contentLength))
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

    private HttpResponseData(int status, string contentType, byte[] body)
    {
        _status = status;
        _contentType = contentType;
        _body = body;
    }

    public static HttpResponseData Json(int status, object body)
    {
        return new HttpResponseData(status, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(body));
    }

    public static HttpResponseData Empty(int status)
    {
        return new HttpResponseData(status, "text/plain; charset=utf-8", Array.Empty<byte>());
    }

    public async Task WriteAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var reason = _status switch
        {
            200 => "OK",
            204 => "No Content",
            400 => "Bad Request",
            404 => "Not Found",
            500 => "Internal Server Error",
            _ => "OK"
        };
        var header = string.Join("\r\n", new[]
        {
            $"HTTP/1.1 {_status} {reason}",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET,POST,OPTIONS",
            "Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Cpipos-Bridge-Test",
            "Access-Control-Allow-Private-Network: true",
            "Access-Control-Max-Age: 86400",
            "Cache-Control: no-store",
            $"Content-Type: {_contentType}",
            $"Content-Length: {_body.Length}",
            "Connection: close",
            "",
            ""
        });
        var headerBytes = Encoding.UTF8.GetBytes(header);
        await stream.WriteAsync(headerBytes.AsMemory(0, headerBytes.Length), cancellationToken).ConfigureAwait(false);
        if (_body.Length > 0)
        {
            await stream.WriteAsync(_body.AsMemory(0, _body.Length), cancellationToken).ConfigureAwait(false);
        }
    }
}

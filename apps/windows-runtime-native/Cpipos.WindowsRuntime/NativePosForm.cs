using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Forms;

namespace Cpipos.WindowsRuntime;

internal sealed class NativePosForm : Form
{
    private readonly RuntimeOptions _options;
    private readonly LocalPrintBridge _bridge;
    private readonly NativePosApiClient _api;
    private readonly ListBox _products = new() { Dock = DockStyle.Fill };
    private readonly ListBox _cart = new() { Dock = DockStyle.Fill };
    private readonly ListBox _history = new() { Dock = DockStyle.Fill };
    private readonly Label _status = new() { Dock = DockStyle.Top, Height = 32, Text = "Native POS" };
    private readonly Dictionary<string, (string Name, decimal Price, int Qty)> _cartItems = new();
    private System.Windows.Forms.Timer? _heartbeatTimer;

    public NativePosForm(RuntimeOptions options, LocalPrintBridge bridge)
    {
        _options = options;
        _bridge = bridge;
        _api = new NativePosApiClient(new Uri(options.AppUrl).GetLeftPart(UriPartial.Authority));
        Text = "CpIPOS Native POS";
        Width = 1280;
        Height = 800;
        WindowState = FormWindowState.Maximized;
        Controls.Add(BuildLayout());
        Controls.Add(_status);
    }

    private Control BuildLayout()
    {
        var tabs = new TabControl { Dock = DockStyle.Fill };
        tabs.TabPages.Add(LoginTab());
        tabs.TabPages.Add(PosTab());
        tabs.TabPages.Add(HealthTab());
        return tabs;
    }

    private TabPage LoginTab()
    {
        var page = new TabPage("Login");
        var store = new TextBox { PlaceholderText = "Store code" };
        var employee = new TextBox { PlaceholderText = "Employee code" };
        var branch = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        var device = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        var login = new Button { Text = "Login / select device", Height = 40 };
        login.Click += async (_, _) =>
        {
            try
            {
                SetStatus("Checking store...");
                var branches = await _api.VerifyStoreAsync(store.Text);
                branch.Items.Clear();
                branch.Items.AddRange(branches.Select(x => new NamedId(x.Id, x.Name)).Cast<object>().ToArray());
                if (branch.Items.Count > 0) branch.SelectedIndex = 0;
                if (branch.SelectedItem is NamedId selectedBranch) await _api.SelectBranchAsync(selectedBranch.Id);
                await _api.VerifyEmployeeAsync(employee.Text);
                var devices = await _api.LoadDevicesAsync();
                device.Items.Clear();
                device.Items.AddRange(devices.Select(x => new NamedId(x.Code, x.Name)).Cast<object>().ToArray());
                if (device.Items.Count > 0) device.SelectedIndex = 0;
                if (device.SelectedItem is NamedId selectedDevice) await _api.SelectDeviceAsync(selectedDevice.Id);
                StartHeartbeat();
                SetStatus("POS session ready");
                await RefreshShiftAndCatalogAsync();
            }
            catch (Exception ex) { SetStatus(ex.Message); }
        };
        page.Controls.Add(Stack(store, branch, employee, device, login));
        return page;
    }

    private TabPage PosTab()
    {
        var page = new TabPage("POS");
        var openShift = new Button { Text = "Open shift" };
        var refresh = new Button { Text = "Refresh catalog/history" };
        var cash = new Button { Text = "Create order + cash payment" };
        openShift.Click += async (_, _) => { await SafeAsync(async () => { await _api.OpenShiftAsync(); await RefreshShiftAndCatalogAsync(); }); };
        refresh.Click += async (_, _) => await SafeAsync(RefreshShiftAndCatalogAsync);
        cash.Click += async (_, _) => await SafeAsync(CheckoutCashAsync);
        _products.DoubleClick += (_, _) => AddSelectedProduct();
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 2 };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 30));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var toolbar = Flow(openShift, refresh, cash);
        grid.Controls.Add(toolbar, 0, 0);
        grid.SetColumnSpan(toolbar, 3);
        grid.Controls.Add(_products, 0, 1);
        grid.Controls.Add(_cart, 1, 1);
        grid.Controls.Add(_history, 2, 1);
        page.Controls.Add(grid);
        return page;
    }

    private TabPage HealthTab()
    {
        var page = new TabPage("MDM / diagnostics");
        var heartbeat = new Button { Text = "Send diagnostics heartbeat" };
        var printer = new Button { Text = "Test local print bridge" };
        heartbeat.Click += async (_, _) => await SafeAsync(() => SendHeartbeatAsync("request_diagnostics"));
        printer.Click += async (_, _) => await SafeAsync(async () => SetStatus(await _api.GetTextAsync(_options.BridgeHealthUrl)));
        page.Controls.Add(Stack(heartbeat, printer));
        return page;
    }

    private async Task RefreshShiftAndCatalogAsync()
    {
        await _api.CurrentShiftAsync();
        var products = await _api.ProductsAsync();
        _products.Items.Clear();
        _products.Items.AddRange(products.Cast<object>().ToArray());
        var orders = await _api.OrdersAsync();
        _history.Items.Clear();
        _history.Items.AddRange(orders.Cast<object>().ToArray());
        SetStatus("Ready");
    }

    private void AddSelectedProduct()
    {
        if (_products.SelectedItem is not ProductRow product) return;
        _cartItems.TryGetValue(product.Id, out var current);
        _cartItems[product.Id] = (product.Name, product.Price, current.Qty + 1);
        RenderCart();
    }

    private async Task CheckoutCashAsync()
    {
        if (_cartItems.Count == 0) throw new InvalidOperationException("Cart is empty.");
        var order = await _api.CreateOrderAsync(_cartItems.ToDictionary(x => x.Key, x => x.Value.Qty));
        await _api.PayCashAsync(order.Id, order.Total);
        _cartItems.Clear();
        RenderCart();
        await RefreshShiftAndCatalogAsync();
        SetStatus($"Paid {order.OrderNo}");
    }

    private void RenderCart()
    {
        _cart.Items.Clear();
        _cart.Items.AddRange(_cartItems.Values.Select(x => $"{x.Name} x{x.Qty} = {x.Price * x.Qty:N2}").Cast<object>().ToArray());
    }

    private void StartHeartbeat()
    {
        _heartbeatTimer?.Stop();
        _heartbeatTimer = new System.Windows.Forms.Timer { Interval = 5 * 60 * 1000 };
        _heartbeatTimer.Tick += async (_, _) => await SafeAsync(() => SendHeartbeatAsync("interval"));
        _heartbeatTimer.Start();
        _ = SendHeartbeatAsync("startup");
    }

    private async Task SendHeartbeatAsync(string reason)
    {
        var drive = new DriveInfo(Path.GetPathRoot(AppContext.BaseDirectory) ?? "C:\\\\");
        var process = Process.GetCurrentProcess();
        var payload = new
        {
            identity = new { device_code = "WINDOWS-POS", machine_id = Environment.MachineName, hostname = Environment.MachineName, runtime_version = "windows-native-pos", app_version = "0.1.8" },
            connectivity = new { internet_online = true, server_reachable = true, network_type = "windows", last_seen_at = DateTimeOffset.UtcNow },
            system = new { os_name = "Windows", os_version = Environment.OSVersion.VersionString, uptime_seconds = Environment.TickCount64 / 1000, memory_mb = process.WorkingSet64 / 1_048_576, disk_total_gb = drive.TotalSize / 1_073_741_824, disk_free_gb = drive.AvailableFreeSpace / 1_073_741_824 },
            runtime = new { cpi_windows_runtime_running = true, local_bridge_online = true, bridge_port = _options.BridgePort, last_error = (string?)null },
            peripherals = new { selected_printer = _options.WindowsPrinter, printer_status = string.IsNullOrWhiteSpace(_options.WindowsPrinter) ? null : "configured" },
            metadata = new { source = "windows_native_pos_mdm", reason, update_channel = "stable", latest_allowed_version = "0.1.8", update_available = false },
            captured_at = DateTimeOffset.UtcNow
        };
        var actions = await _api.SendHeartbeatAsync(payload);
        foreach (var action in actions)
        {
            if (action is "reload_ui" or "restart_app" or "refresh_config") await RefreshShiftAndCatalogAsync();
            if (action is "test_printer") _ = await _api.GetTextAsync(_options.BridgeHealthUrl);
        }
    }

    private async Task SafeAsync(Func<Task> action)
    {
        try { await action(); }
        catch (Exception ex) { SetStatus(ex.Message); }
    }

    private void SetStatus(string text) => _status.Text = text;

    private static FlowLayoutPanel Flow(params Control[] controls)
    {
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill };
        panel.Controls.AddRange(controls);
        return panel;
    }

    private static FlowLayoutPanel Stack(params Control[] controls)
    {
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(24), AutoScroll = true };
        foreach (var control in controls) { control.Width = 420; panel.Controls.Add(control); }
        return panel;
    }
}

internal sealed class NativePosApiClient
{
    private readonly CookieContainer _cookies = new();
    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public NativePosApiClient(string baseUrl)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _http = new HttpClient(new HttpClientHandler { CookieContainer = _cookies }) { Timeout = TimeSpan.FromSeconds(45) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("CpIPOSWindowsNativePOS/0.1.8");
    }

    public async Task<List<BranchRow>> VerifyStoreAsync(string storeCode)
    {
        var data = await PostDataAsync("/api/auth/store-code/verify", new { store_code = storeCode.Trim() });
        return data["branches"]?.AsArray().Select(x => new BranchRow(Text(x?["id"]), Text(x?["name"]))).ToList() ?? [];
    }

    public Task SelectBranchAsync(string id) => PostDataAsync("/api/auth/branches/select", new { branch_id = id });
    public Task VerifyEmployeeAsync(string code) => PostDataAsync("/api/auth/employee/verify-code", new { employee_code = code.Trim() });

    public async Task<List<DeviceRow>> LoadDevicesAsync()
    {
        var data = await GetDataAsync("/api/auth/devices");
        return data["devices"]?.AsArray().Select(x => new DeviceRow(Text(x?["deviceCode"]), Text(x?["deviceName"]))).ToList() ?? [];
    }

    public Task SelectDeviceAsync(string code) => PostDataAsync("/api/auth/devices/select", new { device_code = code, force_override = false });
    public Task CurrentShiftAsync() => GetDataAsync("/api/pos/shifts/current");
    public Task OpenShiftAsync() => PostDataAsync("/api/pos/shifts/open", new { });

    public async Task<List<ProductRow>> ProductsAsync()
    {
        var data = await GetDataAsync("/api/pos/products");
        return data["products"]?.AsArray().Select(x => new ProductRow(Text(x?["id"]), Text(x?["name"]), Money(x?["price"]))).ToList() ?? [];
    }

    public async Task<List<string>> OrdersAsync()
    {
        var data = await GetDataAsync("/api/pos/orders?page=1&page_size=30");
        return data["items"]?.AsArray().Select(x => $"{Text(x?["order_no"])} {Money(x?["grand_total"]):N2}").ToList() ?? [];
    }

    public async Task<OrderRow> CreateOrderAsync(Dictionary<string, int> items)
    {
        var data = await PostDataAsync("/api/pos/orders", new { items = items.Select(x => new { product_id = x.Key, quantity = x.Value }) }, Guid.NewGuid().ToString());
        var order = data["order"];
        return new OrderRow(Text(order?["id"]), Text(order?["order_no"]), Money(order?["grand_total"]));
    }

    public Task PayCashAsync(string orderId, decimal amount) => PostDataAsync("/api/pos/payments", new { order_id = orderId, payment_lines = new[] { new { method = "cash", amount } }, cash_received = amount, change_amount = 0 }, Guid.NewGuid().ToString());

    public async Task<List<string>> SendHeartbeatAsync(object payload)
    {
        var data = await PostDataAsync("/api/pos/device-heartbeat", payload);
        return data["pending_actions"]?.AsArray().Select(x => Text(x?["command_type"])).Where(x => x.Length > 0).ToList() ?? [];
    }

    public async Task<string> GetTextAsync(string url) => await _http.GetStringAsync(url);

    private async Task<JsonObject> GetDataAsync(string path)
    {
        using var response = await _http.GetAsync(_baseUrl + path);
        return await ReadDataAsync(response);
    }

    private async Task<JsonObject> PostDataAsync(string path, object body, string? idempotencyKey = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, _baseUrl + path) { Content = JsonContent.Create(body) };
        if (!string.IsNullOrWhiteSpace(idempotencyKey)) request.Headers.TryAddWithoutValidation("X-Idempotency-Key", idempotencyKey);
        using var response = await _http.SendAsync(request);
        return await ReadDataAsync(response);
    }

    private static async Task<JsonObject> ReadDataAsync(HttpResponseMessage response)
    {
        var root = JsonNode.Parse(await response.Content.ReadAsStringAsync())?.AsObject() ?? new JsonObject();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(Text(root["error"]?["message"]) is { Length: > 0 } message ? message : response.ReasonPhrase ?? "CpIPOS API failed");
        return root["data"]?.AsObject() ?? new JsonObject();
    }

    private static string Text(JsonNode? node) => node?.GetValue<string?>() ?? string.Empty;
    private static decimal Money(JsonNode? node) => node?.GetValue<decimal?>() ?? 0m;
}

internal sealed record NamedId(string Id, string Name)
{
    public override string ToString() => string.IsNullOrWhiteSpace(Name) ? Id : Name;
}

internal sealed record BranchRow(string Id, string Name);
internal sealed record DeviceRow(string Code, string Name);
internal sealed record ProductRow(string Id, string Name, decimal Price)
{
    public override string ToString() => $"{Name} - {Price:N2}";
}
internal sealed record OrderRow(string Id, string OrderNo, decimal Total);
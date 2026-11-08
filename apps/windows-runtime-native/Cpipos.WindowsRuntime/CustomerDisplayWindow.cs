using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Drawing;
using System.Windows.Forms;

namespace Cpipos.WindowsRuntime;

/// <summary>
/// Read-only Customer Display V2 hosted on a POS device's secondary Windows monitor.
/// Uses the existing primary WebView2 environment so the terminal's authenticated
/// session is reused, but never injects the local printer bridge or admin controls.
/// </summary>
internal sealed class CustomerDisplayWindow : Form
{
    private readonly WebView2 _view;

    internal CustomerDisplayWindow(Screen screen)
    {
        Text = "CpIPOS Customer Display";
        StartPosition = FormStartPosition.Manual;
        Bounds = screen.Bounds;
        FormBorderStyle = FormBorderStyle.None;
        ControlBox = false;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowIcon = false;
        ShowInTaskbar = false;
        BackColor = Color.White;
        _view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White };
        Controls.Add(_view);
    }

    internal async Task StartAsync(CoreWebView2Environment environment, Uri appUri)
    {
        // Same-origin, dedicated read-only display route. This does not open
        // arbitrary URL input and cannot access the cashier's local print token.
        var displayUri = new Uri(appUri.GetLeftPart(UriPartial.Authority) + "/customer-display/v2/native");
        await _view.EnsureCoreWebView2Async(environment);
        var core = _view.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.NavigationStarting += (_, args) =>
        {
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var target) ||
                !string.Equals(target.GetLeftPart(UriPartial.Path), displayUri.GetLeftPart(UriPartial.Path),
                    StringComparison.OrdinalIgnoreCase))
            {
                args.Cancel = true;
            }
        };
        core.Navigate(displayUri.ToString());
    }
}

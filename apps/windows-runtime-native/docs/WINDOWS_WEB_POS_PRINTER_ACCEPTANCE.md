# CpIPOS Windows Web POS — installer and physical-printer acceptance

## Purpose and isolation

This is a **separate ONLINE Windows Web POS** installer for customers moving from unsupported Android POS terminals to Windows 10/11 x64. It packages the **existing** `Cpipos.WindowsRuntime.exe` and launches it with `--legacy-web-pos --windowed`, which opens the authoritative CpIPOS Web POS in Microsoft Edge WebView2.

- Install package: `CpIPOS-WindowsWebPOS-Setup.exe`
- Installed shortcut: **CpIPOS Windows Web POS**
- Production site: `https://cp-ipos-web.vercel.app/login/store`
- Local print bridge: `127.0.0.1:3210`; per-launch bridge token is injected into the WebView session.
- Install directory: `%LOCALAPPDATA%\Programs\CpIPOS-WindowsWebPOS`
- Requires Microsoft Edge **WebView2 Runtime**; confirm it is installed and maintained.
- Does **not** create a second orders database, copy tenant data, or change any Supabase configuration.
- Does **not** replace `cp-ipos-desktop` (separate offline-first POS) or the existing `CpIPOS-WindowsRuntime-Setup.exe`.
- Do not run other CpIPOS Windows Runtime instances at the same time: they may compete for port 3210 and attached peripherals.

The filename and shortcut keep the older technical command line `--legacy-web-pos` because that is the existing WebView2 mode. The customer sees **Windows Web POS**, not "legacy".

## Build and download (after review and merge)

Run **Build CpIPOS Windows Runtime** from GitHub Actions **with ref `main` explicitly selected**. This workflow builds both the pre-existing Windows Runtime package and the dedicated Windows Web POS installer. The new Windows Web POS installer is uploaded as a workflow artifact, but is **not released publicly by default**. Leave `publish_web_pos=false` until printer acceptance is complete. After hardware acceptance, explicitly select `publish_web_pos=true` on the approved release run, confirm the published binary checksum, then update the company Download Center in a separate reviewed change. Do not overwrite or relabel the unrelated `cp-ipos-desktop` 0.3.4 installer.

If the WebView2 Runtime is absent on the customer machine, install it from Microsoft's official WebView2 Runtime distribution. A successful setup.exe install does not itself prove WebView2 or the printer works.

## Print bridge source audit (2026-11-04)

The native bridge source exposes `GET /health`, token-protected `GET /printers`, `POST /print/test`, and `POST /print`. Requests are serialized by `_printLock` to reduce overlapping print jobs. This is useful but **does not guarantee duplicate prevention or physical delivery**.

Items that must pass before customer rollout:

1. **Spool acknowledgement vs actual paper**: the bridge returns `printed: true` after submitting to the Windows print mechanism, not after observing the printer mechanically finish the receipt. A timed-out submission may still later print. Never blindly retry failed/unknown print outcomes.
2. **No stable idempotency key across /print requests**: the bridge currently creates a new timestamp-based job ID on each call, rather than durably deduplicating the server's receipt/print-job ID. Define a server-backed print-job identity and acknowledge it safely before enabling automatic retry/reprint.
3. **Timeout mismatch**: the HTTP connection has a 30-second request deadline, while text printing uses an internal 45-second timeout. A slow spooler can outlive the HTTP request and leave the caller uncertain. Reconcile timeouts and distinguish queued/accepted/unknown/delivered states.
4. **HTML printing implementation**: current `PrintHtmlAsync` uses WinForms `WebBrowser` (older rendering engine) and temporarily changes the Windows system default printer. Test Thai glyphs, 58 mm and 80 mm sizing, logos and QR codes, multi-user Windows sessions, and recovery after render timeout. Prefer a future implementation that does not change global default printer.
5. **Connection method**: Windows must detect an installed driver/queue for USB, LAN or Bluetooth printer. Driver availability and compatibility are hardware-specific; do not imply that any ESC/POS device will work without setup.
6. **Bridge availability**: if port 3210 is occupied, the application warns and printing is unavailable. Verify `/health` and that another POS instance did not consume the port.
7. **WebView2 navigation and local authorization**: ensure session bridge token remains scoped to the trusted production origin. Test login redirects, expired sessions and deep-link behavior.

## Physical acceptance checklist (MUST complete on customer-equivalent Windows POS)

Record device name, Windows build, installed WebView2 version, printer brand/model, driver version, port (USB/LAN/Bluetooth), paper width, and technician initials. Do not mark checks green without observed results.

- [ ] Installer launches **Web POS**, not the standalone Native POS screen; shortcuts work after reboot
- [ ] Web POS login/branch/device authentication, open shift, sale, payment and close shift succeed
- [ ] Windows Settings → Printers & scanners shows the correct printer; the queue is not paused/offline
- [ ] Local bridge health returns online, authorized printers list contains the selected printer
- [ ] Test print on **58 mm**: Thai/English glyphs, totals, discounts, QR, logo, cut/feeding, width and margins
- [ ] Test print on **80 mm** with the same cases
- [ ] Print 20 consecutive receipts: correct order, no clipping, no unexplained duplicates
- [ ] Print 100 receipts across multiple sales/shift transitions: no loss, stale pending jobs or memory growth
- [ ] Unplug/replug USB, unplug/replug LAN, and reconnect Bluetooth when applicable; recover with explicit status
- [ ] Disable printer/paper or pause Windows spooler during a print; show UNKNOWN outcome and **do not auto-repeat**
- [ ] Restart the application during a pending print; verify that duplicate protection survives restart
- [ ] Open the cash drawer while printing; ensure drawer pulse does not interfere with receipt data
- [ ] Confirm reprint is an explicit audited action distinct from first print
- [ ] Restart Windows; printer selection and shift/session behavior remain safe
- [ ] Verify no private data or long-lived bridge token leaks to a nonproduction origin

### Release gate

**Not yet accepted:** source review and packaging alone do not prove printer stability. Before Production distribution, resolve uncertain print acknowledgement/deduplication, run the Windows installer workflow, verify artifact/signature/checksum, and complete physical 58/80 mm acceptance on actual hardware. Do not make database or payment-rule changes to work around printing faults.

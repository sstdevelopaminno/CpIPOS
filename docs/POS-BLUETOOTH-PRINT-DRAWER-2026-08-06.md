# POS Bluetooth Print + Cash Drawer 2026-08-06

Branch: `agent/revert-raster-print-to-stable` (PR #31 into `agent-docs-preflight-schema-drift`)

## Scope

Adds/repairs Bluetooth receipt printing and cash-drawer opening for the CpIPOS web app on both Windows and Android, per user request. Two independent paths exist; read the right section for your hardware.

## 1. Windows + OS-paired Bluetooth printer

**This already worked with zero new code** for printers set up as `LOCAL_BRIDGE` connection type: pair the printer at the Windows OS level (`Devices > Bluetooth & other devices > Add printer`), then configure a normal `LOCAL_BRIDGE` printer profile pointing at `http://127.0.0.1:3210/print`. The Windows print driver abstracts the Bluetooth transport; `LocalPrintBridge.cs` (the Windows Runtime bridge) only ever resolves printers by name via `PrinterSettings.InstalledPrinters` and writes through the driver — it never checks transport.

**Fixed this round**: the distinct `BLUETOOTH_BRIDGE` connection type (`apps/backoffice-web/src/lib/printing/adapters/bluetooth-bridge-adapter.ts`) was broken against the current bridge:
- It never sent the `X-CpIPOS-Bridge-Token` header, so every request 401'd against `LocalPrintBridge.cs`'s `IsAuthorizedBridgeRequest` check.
- It always posted to the plain print endpoint, even for `open_cash_drawer` commands, instead of `/cash-drawer/open`.

Both are now fixed — `BluetoothBridgeAdapter` sends the same authenticated request contract as `LocalBridgeAdapter` (bridge token, correct drawer endpoint, `drawer_*` fields passed through). `bluetooth_address`/`bluetooth_name` metadata fields are passed through for diagnostics only; they are not used to actually address the device (Windows already resolves the printer by name).

**Practical recommendation**: prefer `LOCAL_BRIDGE` connection type for Windows + Bluetooth-paired printers going forward — it's simpler and was never broken. `BLUETOOTH_BRIDGE` is now also functional if already configured that way.

## 2. Android Web Bluetooth agent (no PC, no native app)

Previously did not exist at all (0 lines of code). Android/tablet browsers could only create server `print_jobs` for a separate print station to claim (`mobile_remote_station` mode) — no direct print or drawer capability of their own.

### What was built

- `apps/backoffice-web/src/components/printing/browser-print-shared.ts` — extracted the transport-agnostic receipt byte-generation logic (HTML→canvas→ESC/POS raster, cash-drawer pulse bytes, print-agent claim/ack/fail API calls) out of `browser-print-agent.tsx` (Web Serial) so it can be reused without duplication. `browser-print-agent.tsx`'s public exports and behavior are unchanged.
- `apps/backoffice-web/src/components/printing/browser-bluetooth-print-agent.tsx` — new Web Bluetooth GATT agent. Polls the same `/api/print-agent/v1/jobs/claim` queue as the Web Serial agent (same job model, same `browser-agent://web-serial` printer-profile marker — see `docs/BLUETOOTH-BRIDGE-SETUP.md`), writes bytes to a GATT characteristic in small chunks instead of `navigator.serial.write`.
- Wired into `browser-print-agent-pos-host.tsx` as a new `bluetooth_experimental` mode, opt-in only (does not change any existing default), following the same pattern as the pre-existing `web_serial_experimental` opt-in.
- Status codes added to `browser-print-agent-alert.tsx` so pairing/connection problems show the same popup UI used for Web Serial issues.
- Settings UI added to `apps/backoffice-web/src/components/backoffice/printers-module.tsx` ("Bluetooth Print Agent (Web Bluetooth, ไม่ต้องมีเครื่อง PC)" section): enable toggle, optional Service/Characteristic UUID override fields, reuses the same Print Agent secret as the Web Serial section.

### Why opt-in, not default

`docs/PRINT-ADAPTER-ARCHITECTURE-2026-08-02.md` explicitly says not to make Chrome Web Bluetooth the default path for Android (limited browser support, no iOS support, less reliable than a native bridge). This feature is gated the same way Web Serial experimental already is — a device only runs it if explicitly enabled via the settings toggle (`cpi_browser_print_agent_bluetooth_enabled_v1` in localStorage, per-device).

### GATT UUID handling — important limitation

There is no single standard GATT service/characteristic for ESC/POS printers over BLE; every vendor does it differently. The agent probes a list of the most commonly reused UUID pairs (in `DEFAULT_UUID_CANDIDATES` in `browser-bluetooth-print-agent.tsx`) when the operator has not entered an explicit override:

1. `000018f0-.../00002af1-...` — common generic thermal printer BLE profile
2. `0000ffe0-.../0000ffe1-...` — HM-10-style UART clone, common in budget modules
3. `49535343-fe7d-.../49535343-8841-...` — ISSC/JDY UART service
4. Nordic UART Service `6e400001-.../6e400002-...`

**These defaults are unverified against real hardware** (no BLE printer was available to test in this environment). If none of them connect, enter the exact Service UUID and Write Characteristic UUID for the target printer model in the settings panel — check the printer vendor's SDK/manual or a BLE scanner app. This is a real limitation flagged for the user to validate on their own device before relying on it in production.

### Pairing UX

Web Bluetooth requires an explicit user gesture to pair (unlike Web Serial's silent `getPorts()` reconnect). When the Bluetooth agent is enabled but no device is paired yet, a floating "เชื่อมต่อเครื่องพิมพ์ Bluetooth" button appears at the bottom-right of the POS screen. After the first successful pairing, Chrome's persisted-permission API (`navigator.bluetooth.getDevices()`) is used to attempt silent reconnect on future page loads without a new prompt.

### Cash drawer over Bluetooth

Reuses the exact same `bytesForCashDrawer()` ESC/POS pulse bytes as the Windows/Serial paths — once the GATT write path works for printing, drawer-open works the same way (same characteristic, same bytes), no separate mechanism needed. No backend changes were required: `cash-drawer-controller-service.ts` is already transport-agnostic and just enqueues an `open_cash_drawer` print_job for whichever agent claims it.

### Manual QA required (not done in this round — no BLE hardware available here)

1. On an Android Chrome tablet, open POS settings, enter/confirm the Print Agent secret, enable the Bluetooth Print Agent, save.
2. Go to `/preview/pos`, tap "เชื่อมต่อเครื่องพิมพ์ Bluetooth", select the printer from the OS chooser.
3. Confirm a test/payment receipt print job is claimed and printed.
4. If print fails, check the alert popup's message — if it names a GATT connect failure, enter the printer's actual Service/Characteristic UUID in settings and retry.
5. Confirm cash drawer opens via the same printer profile's drawer settings.
6. Reload the page and confirm the printer reconnects without a new pairing prompt (Chrome persisted-permission reconnect).
7. Verify no regression in existing Web Serial (Windows) or `LOCAL_BRIDGE`/`BLUETOOTH_BRIDGE` (Windows Runtime) print paths.

## Verification run this round

- `pnpm --filter backoffice-web typecheck`: pass (both after the `browser-print-shared.ts` extraction and after the full Bluetooth feature)
- No BLE/Web Bluetooth hardware was available to test in this environment — flagged above as required manual QA before production use.

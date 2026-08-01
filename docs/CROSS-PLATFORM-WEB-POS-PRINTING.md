# Cross-Platform Web POS Printing

Last updated: 2026-08-02

## Goal

CpIPOS must support POS sales from Chrome/web app on Windows, Android tablets, and iOS/iPadOS devices without making every device connect directly to the receipt printer.

The stable runtime model is:

```text
POS browser device -> creates server print_jobs
Print station/agent -> claims print_jobs and sends bytes to the printer
```

## Supported modes

### Windows / desktop Chrome or Edge

Use this as the preferred local print station.

- Chrome/Edge can use Web Serial when supported by the browser and printer driver/port.
- The POS page mounts `BrowserPrintAgent` only when the browser looks like a desktop browser with Web Serial support.
- The agent claims jobs from `/api/print-agent/v1/jobs/claim` and prints through the configured port.

### Android tablet Chrome

Use as a POS sales device first.

- Direct printer connection from Android Chrome is not guaranteed because many 58/80mm thermal printers use Bluetooth Classic/SPP or USB serial patterns that mobile browsers do not expose consistently.
- The POS should create print jobs normally.
- A Windows desktop, Android bridge app, network bridge, or dedicated print station should claim and print the jobs.
- Direct mobile-agent mode is intentionally disabled by default. It can be enabled only for tested devices by setting localStorage key `cpi_browser_print_agent_mobile_direct_v1=1`.

### iOS / iPadOS Chrome

Use as a POS sales device only.

- Do not depend on direct Web Serial/Web Bluetooth receipt printing from iOS Chrome.
- Print through a remote print station or bridge that claims server print jobs.

## Runtime guardrail

`apps/backoffice-web/src/components/printing/browser-print-agent-pos-host.tsx` decides the print mode:

- `desktop_local_agent`: mount `BrowserPrintAgent` and allow local printing.
- `mobile_remote_station`: do not mount Web Serial agent on mobile; print jobs must be handled by another station.
- `unsupported_remote_station`: do not mount Web Serial agent; use a remote print station.

This keeps the POS web app usable on Android/iOS without producing unstable local-printer prompts or forcing mobile browsers into unsupported hardware APIs.

## Recommended deployment

For each branch:

1. Register at least one receipt printer profile.
2. Register at least one active print agent/station.
3. Assign the printer to that station with one of these printer metadata fields when needed:
   - `assigned_agent_id` / `assigned_agent_ids`
   - `agent_device_code` / `agent_device_codes`
4. Keep Android/iOS tablets as sales devices unless the exact printer and browser path has been tested.

## Failure handling

The POS UI includes `BrowserPrintAgentAlert`, which listens for `cpi-browser-print-agent-status` and shows alerts for local print-agent failures such as missing agent key, no selected port, unsupported browser, serial write failure, printer offline, and generic print failures.

Paper-out, cover-open, and jam alerts can be precise only when the printer/bridge reports those states. If a printer does not send status feedback, CpIPOS shows a safe generic warning such as printer not responding or print failed.

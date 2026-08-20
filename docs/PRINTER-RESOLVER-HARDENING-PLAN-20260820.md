# CpIPOS Android Printer Resolver Hardening — 2026-08-20

Status: planning checkpoint only. No production merge/deploy.

Hardware evidence from Android 1.0.14 Printer Lab on store 900001 / POS-COUNTER-01:
- LANDI C20Pro / Android 13
- USB printer-class candidate: GLPrinter80 (VID 1048 / PID 20497), bulk OUT endpoint available
- Bonded Bluetooth printer-hint candidate: Inner Printer (00:01:02:03:0A:0B)
- Other writable USB peripherals are present (Realtek LAN, UART bridge, USB Video) and must never be auto-selected as printers

Resolver hardening requirements for the next lab runtime:
1. Preserve explicit printer assignment as authority.
2. USB auto-selection may only consider printer-class or printer-name-hint devices.
3. Generic writable USB devices remain supported only with explicit physical selectors (VID/PID/device path/serial/slot).
4. Bluetooth must never fall back to an arbitrary sole bonded device. With no explicit address/name, only one printer-hint bonded device may be selected.
5. No automatic reassignment when hardware changes.
6. No production rollout and no changes to Android 1.0.12 stable artifacts/update policy.

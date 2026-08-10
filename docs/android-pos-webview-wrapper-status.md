# CpIPOS POS - Android Tablet WebView Wrapper Status

## Current source of truth

- Product/runtime: **CpIPOS POS - Android Tablet**
- Android package: `com.cpipos.pos`
- Current APK version: **v0.2.2**
- Current `versionCode`: **5**
- Runtime strategy: **CpIPOS Web App wrapper first** with **MDM-lite development bridge**
- Web entrypoint: `https://cp-ipos-web.vercel.app/login/store`
- MDM-lite heartbeat endpoint: `https://cp-ipos-web.vercel.app/api/android-pos/mdm/heartbeat`
- Download route: `/download/android/latest`
- Latest release asset: `CpIPOS-Android-debug.apk`
- Release tag: `android-runtime-latest`
- Latest published APK size: `9,439,941 bytes`
- Latest published APK SHA256: `0c46918daec511ccba5d18c40907039140ddffbae3d11686de4660e4fc05556e`
- Latest Android build run: `31427774213`
- Latest Android build result: `success`
- Current user checkpoint: **APK v0.2.2 has been installed on the real company POS machine for testing.**

This file is the main handoff document for future Android POS work. If a new chat starts, read this file first before changing Android POS, MDM, printer, download, release, or IT Admin code.

## Business role of the POS machine

The Android POS machine is a company-owned device that will be sold or provided to customers together with the CpIPOS monthly rental/subscription POS system.

The company must be able to support and control the POS device during service, maintenance, development, printer integration, and customer support. The control scope must be business-safe and limited to the company-owned POS stack.

## Current status

### Done

- Android POS has been aligned as a WebView wrapper around the CpIPOS Web App.
- Download Center must expose only **CpIPOS POS - Android Tablet** as downloadable.
- CpIPOS Mobile, Windows POS, and IT Admin Runtime must remain **กำลังพัฒนา** until explicitly approved.
- APK v0.2.2 / versionCode 5 has been built and published through GitHub Actions.
- `/download/android/latest` redirects to the latest Android POS APK release asset.
- MDM-lite is embedded in the Android POS APK for the current development/testing phase.
- MDM-lite heartbeat endpoint exists in the web backend.
- APK v0.2.2 has been installed on the real company POS machine for testing.

### Not done yet

- Printer hardware integration is not complete.
- Real printer behavior must be tested on the actual POS machine.
- Full MDM / Device Owner / Android Enterprise control is not implemented yet.
- IT Admin Device Console is not implemented yet.
- CPU usage, full RAM telemetry, GPS/province verification, POS problem telemetry, app uninstall/update control, and full remote diagnostics are not complete yet.
- Signed production APK is not complete yet.

## Current MDM-lite scope in v0.2.2

MDM-lite is intentionally limited to app-level diagnostics and safe app-level commands while the POS machine and printer are being developed.

Allowed MDM-lite commands:

- `ping`
- `collect_diagnostics`
- `reload_webview`
- `navigate_home`
- `clear_webview_cache`
- `clear_cookies`
- `clear_webview_data`
- `test_printer_connection`

MDM-lite diagnostics currently cover:

- app package
- app version name/code
- install id
- device manufacturer/brand/model
- Android version / SDK
- uptime
- network online/type
- battery percentage
- app memory
- available app storage
- WebView URL/title/back state/page error
- configured printer host/port and last printer test result

MDM-lite is **not** a full MDM. It does not provide remote shell, file browsing, camera/microphone access, app installation, app removal, device wipe, full kiosk policy, OS-level control, or device-owner policy.

## Required next phase after POS reaches 100%

After the POS flow is completed and stable, the next major phase must be:

**CpIPOS Full MDM + IT Admin Device Console**

This must be treated as a separate controlled architecture phase, not a small patch inside the POS screen.

### Target business requirements

Full MDM must help the company support rented/sold POS machines by showing and controlling:

- online/offline status
- last heartbeat time
- network status and network type
- backend reachability
- printer status and printer test result
- CPU usage
- RAM usage
- used/free storage
- battery/charging/uptime
- POS app version and build version
- WebView/POS runtime error
- POS usage problem signals such as login fail, shift fail, sales fail, print fail, sync fail, network fail
- tenant / branch / registered device code
- machine serial/device identifier
- location/province of the physical device
- comparison between device location/province and branch/customer document location
- device health score for support triage

### Target safe control commands

Full MDM should allow IT Admin to control only the company POS stack, including:

- reload POS app
- restart POS app
- clear POS cache/cookies
- update POS app
- reinstall POS app
- uninstall only the company POS app package `com.cpipos.pos`
- test printer
- update printer configuration
- collect diagnostics
- lock the device into POS/kiosk mode when appropriate
- temporarily disable the POS device for rental/subscription enforcement when contract/payment status requires it

### Correct full MDM architecture decision

Full MDM should not remain only inside the POS app.

Recommended structure:

- POS app: `com.cpipos.pos`
- MDM/Device Agent app: `com.cpipos.mdm`
- IT Admin backend console: device list, device detail, commands, diagnostics, health history, printer diagnostics, location/document match, support logs

Reason: if the MDM logic lives only inside `com.cpipos.pos`, then uninstalling or repairing the POS app also removes the controller. A separate Device Agent is required for stable device management.

For company-owned POS machines, the full MDM phase should use Android Enterprise / Device Owner / Dedicated Device mode where possible, configured during device preparation before sending to customers.

## Development rules from user

- The assistant is responsible for helping develop, improve, and fix Android POS code when the user gives instructions.
- Every code, behavior, workflow, release, deployment, or architecture change must update the relevant documentation in the same work cycle.
- Do not mix Android POS with CpIPOS Mobile, Windows POS, or IT Admin Runtime.
- Do not claim 100% completion until real POS-machine and printer tests are passed.
- Do not sync or ask the user to update local VS Code/computer until the current change is complete and verified.
- If a new chat starts, continue from this document and the latest GitHub/Vercel state.

## Current testing focus

The current installed version on the POS machine is v0.2.2. The next testing focus is:

1. Confirm WebView opens `/login/store` correctly on the physical POS machine.
2. Confirm login/session/cookie behavior survives app background/foreground and device sleep.
3. Confirm branch/device/shift/sales flow on the physical POS machine.
4. Confirm MDM-lite heartbeat reaches the backend.
5. Confirm MDM-lite diagnostics can identify network and WebView status.
6. Configure and test printer host/port.
7. Run `test_printer_connection` against real printer hardware.
8. Decide printer architecture: JavaScript bridge, native print bridge, API print queue, or hybrid.
9. After POS flow and printer reach production readiness, start the Full MDM + IT Admin Device Console phase.

## Current version history

- v0.2.0 / versionCode 3: previous Android POS APK before WebView wrapper alignment.
- v0.2.1 / versionCode 4: WebView wrapper runtime aligned to CpIPOS Web App.
- v0.2.2 / versionCode 5: WebView wrapper with MDM-lite development bridge and heartbeat endpoint; installed on the real company POS machine for testing.

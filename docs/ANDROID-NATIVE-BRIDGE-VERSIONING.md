# Android Native Bridge Versioning

Date: 2026-08-02
Status: Documentation only. No production code changes.

## Purpose

Define a safe versioning strategy for future Android native bridge APIs used by the CpIPOS fullscreen APK shell. The bridge must allow the existing web POS UI to call Android-native capabilities without tying normal web UI deployments to APK releases.

This document designs the bridge contract only. It does not implement native Android code.

## Current CpIPOS Behavior To Preserve

CpIPOS currently runs as a web POS/backoffice application. The existing web app must remain functional in browser/PWA environments without requiring Android-only features.

The bridge strategy must preserve:

- existing web POS UI as the main UI
- existing web login and POS routes
- existing API/server session behavior
- existing Print Adapter Architecture direction
- non-blocking payment behavior when printing/cash drawer fails
- server-side tenant, branch, device, role, and permission validation

## Proposed Architecture

Expose future Android native capabilities under one stable namespace:

```js
window.CpIPOSBridge
```

Recommended initial method set:

```text
CpIPOSBridge.getDeviceInfo()
CpIPOSBridge.getNetworkStatus()
CpIPOSBridge.getAppVersion()
CpIPOSBridge.getBridgeVersion()
```

Hardware methods for later phases:

```text
CpIPOSBridge.printReceipt(payload)
CpIPOSBridge.printKitchenTicket(payload)
CpIPOSBridge.openCashDrawer(payload)
CpIPOSBridge.getPrinterStatus()
```

Bridge methods must be versioned and feature-detected before use. The web UI must never assume that Android native features exist.

## Version Strategy

Keep four version surfaces separate:

| Version | Owner | Changes When | APK Update Required |
| --- | --- | --- | --- |
| `web_ui_version` | Web deployment | POS/backoffice UI changes | No |
| `api_contract_version` | Backend/API | API payload/behavior contract changes | Maybe, only if native bridge depends on it |
| `native_app_version` | Android APK | Android shell/runtime changes | Yes |
| `native_bridge_version` | Android bridge | Native bridge method contract changes | Yes |

Rule:

```text
Web UI changes must update online without APK update.
Native hardware/offline/device API changes require APK update only when the bridge contract changes.
```

## Data Flow

### Bridge Detection

```text
Web UI loads
-> checks window.CpIPOSBridge exists
-> calls getBridgeVersion() if available
-> checks supported methods/capabilities
-> enables native-only buttons/features only when supported
```

### Print Receipt Future Flow

```text
Payment completes server-side
-> print job/receipt payload is created
-> web UI requests native print through adapter only when available
-> CpIPOSBridge.printReceipt(payload)
-> Android native layer prints or returns failure
-> print result is logged
-> payment remains completed regardless of print result
```

### Network Status Flow

```text
Web UI requests getNetworkStatus()
-> Android returns online/offline/local network status
-> web UI displays banner and adjusts sync behavior
-> server remains authoritative for tenant/session validation
```

## Proposed Bridge Response Shape

Bridge calls should return structured responses:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "bridge_version": "1.0.0",
  "native_app_version": "1.0.0"
}
```

Failure response:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "printer_not_available",
    "message": "Printer is not connected."
  },
  "bridge_version": "1.0.0",
  "native_app_version": "1.0.0"
}
```

## Security Rules

- Do not expose Supabase service role key in native bridge responses.
- Do not expose admin secrets in APK or bridge calls.
- Do not allow native bridge to grant tenant/branch/session permissions.
- Do not allow web UI to use native device info as proof of authorization.
- Do not let native bridge write authoritative orders/payments directly without server validation.
- Print/cash drawer bridge methods must be scoped by server-created payloads or server-trusted POS session context.
- Native bridge failures must be retryable and observable but must not corrupt payment state.
- Bridge capabilities must be feature-detected and version-gated.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Web UI calls unsupported bridge method | Runtime error in APK | Feature detection and capability map |
| Bridge version changes without web guard | Print/device features fail | Versioned bridge contract and compatibility checks |
| Native bridge bypasses server scope | Tenant/branch security breach | Server remains source of truth; bridge handles hardware only |
| Printing blocks payment completion | Cashier flow stuck | Payment completion server-side first; printing async/non-blocking |
| APK update needed for every UI change | Slow operations | Keep UI web-based; bridge only for native capabilities |

## Implementation Phases

### Phase 0: Documentation

- Define bridge namespace and version rules only.
- Do not implement Android bridge methods yet.

### Phase 1: Read-Only Bridge

Implement only:

```text
getAppVersion()
getBridgeVersion()
getDeviceInfo()
getNetworkStatus()
```

These methods must not mutate orders, payments, sessions, tenants, or devices.

### Phase 2: Capability Map

Add:

```text
CpIPOSBridge.getCapabilities()
```

Example capabilities:

```text
print.receipt
print.kitchen_ticket
cash_drawer.open
network.status
storage.offline_queue
```

### Phase 3: Hardware Bridge

Add print/cash drawer methods only after payload contracts are reviewed:

```text
printReceipt(payload)
printKitchenTicket(payload)
openCashDrawer(payload)
getPrinterStatus()
```

### Phase 4: Offline Bridge

Add local database/sync primitives only after the offline-first future phase is designed and approved.

## Acceptance Checklist

- [ ] Bridge namespace is versioned and feature-detected.
- [ ] Web UI works without native bridge.
- [ ] Web UI updates do not require APK updates.
- [ ] APK updates are required only for native app/bridge contract changes.
- [ ] Bridge does not bypass server-side tenant/branch/device/session validation.
- [ ] Bridge does not expose Supabase service role key or admin secrets.
- [ ] Print/cash drawer bridge failures do not block payment completion.
- [ ] Existing web app and POS routes remain unchanged during documentation phase.

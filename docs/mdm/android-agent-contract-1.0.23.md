# CpIPOS Android Agent Contract — Android 1.0.23 + Web Production

This contract defines the only Android client behavior that is allowed to participate in full MDM for this release.

## Release scope

Full MDM is limited to:

- Android app version: `1.0.23`
- App flavor: `web-production`, `web_production`, or `production_web`
- Ownership: `company_owned` or `company_financed`
- Enrollment: `android_enterprise_device_owner`, `fully_managed`, or `dedicated_device`
- Android Device Owner: `true`
- Required capability: `mdm_core`

The following are excluded from full MDM and must remain diagnostics-only:

- Android `1.0.12 LTS`
- Android versions other than `1.0.23`
- Native `2.0`
- Customer-owned devices
- BYOD devices
- Devices with `device_owner=false`
- Devices installed outside the managed enrollment flow

## Heartbeat payload

The Android 1.0.23 agent must send a heartbeat with these fields:

```json
{
  "tenantId": "uuid",
  "deviceId": "FF0001-POS-01",
  "serialNumber": "optional-hardware-serial",
  "displayName": "Store Front POS 01",
  "platform": "android",
  "appVersion": "1.0.23",
  "appFlavor": "web-production",
  "nativeGeneration": null,
  "ownershipType": "company_financed",
  "enrollmentMode": "android_enterprise_device_owner",
  "isDeviceOwner": true,
  "capabilities": [
    "mdm_core",
    "remote_lock",
    "location",
    "remote_support",
    "app_install",
    "app_uninstall",
    "policy_sync"
  ],
  "android": {
    "sdkInt": 33,
    "manufacturer": "SUNMI",
    "model": "D3 MINI",
    "webViewVersion": "138.0.7204.180"
  }
}
```

## Command polling

The agent may pick up only queued commands that match all of these rules:

1. `tenantId` matches the enrolled tenant.
2. `deviceId` matches the enrolled device.
3. command status is `queued`.
4. command is not expired.
5. local agent confirms Device Owner before executing privileged actions.
6. command type is included in the device capability list.

Recommended polling behavior:

- foreground/dedicated mode: every 15–30 seconds
- background mode: exponential backoff, not aggressive polling
- network failure: retry with backoff, never a tight loop
- after command completion: post result and command audit event

## Android privileged actions

The following actions require Device Owner or compatible Android Enterprise enrollment:

| Command | Android behavior | Required capability |
| --- | --- | --- |
| `lock_device` | Use `DevicePolicyManager.lockNow()` or policy equivalent | `remote_lock` |
| `unlock_device` | Clear app-level financing lock state; OS unlock depends on active policy | `remote_lock` |
| `financing_lock` | Enter company financing lock / limited mode | `remote_lock` |
| `request_location` | Send one-time location result with audit | `location` |
| `start_remote_support` | Start explicit attended or company-kiosk support session | `remote_support` |
| `stop_remote_support` | Stop active support session and write audit result | `remote_support` |
| `install_app` | Install managed package according to policy | `app_install` |
| `uninstall_app` | Uninstall managed package, never the core CpIPOS agent directly | `app_uninstall` |
| `sync_policy` | Refresh local MDM policy cache | `policy_sync` |

## Remote screen support policy

Remote screen access must be implemented as Remote Support Session only.

Allowed session modes:

- `attended`: support session visible to an active user/operator
- `company_kiosk`: company-owned or company-financed kiosk/POS mode with prior enrollment and policy notice

Not allowed:

- silent screen viewing
- unlimited-duration sessions
- sessions without audit log
- sessions on BYOD/customer-owned devices
- sessions on `device_owner=false` devices

Maximum session TTL for this release: 60 minutes.

## FF0001-POS-01 current status

The known device `FF0001-POS-01` reported Android Modern `1.0.21/code29` and `device_owner=false`. It must remain diagnostics-only until re-enrolled as Android 1.0.23 Web Production Device Owner.

## Native 2.0 rule

Native 2.0 must not receive this full MDM implementation in this release. It may read diagnostics status only until a separate Native 2.0 MDM plan is approved.

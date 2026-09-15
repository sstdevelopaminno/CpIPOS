# Smoke Test — MDM Android 1.0.23 + Web Production

ใช้ checklist นี้ก่อน merge/deploy ระบบ MDM ไป Production จริง

## Test environment

- Branch: `feature/mdm-android-1-0-23-web-production-final`
- Base: `release/pos-prod-base-20260828`
- Target release: Android `1.0.23 + Web Production`
- Test device: Android Enterprise Device Owner / Fully Managed / Dedicated Device เท่านั้น
- Do not test destructive commands on customer devices

## 1. Branch and build checks

- [ ] Checkout branch `feature/mdm-android-1-0-23-web-production-final`
- [ ] Install dependencies
- [ ] Run TypeScript check
- [ ] Run unit tests
- [ ] Confirm no compile error from `src/lib/mdm/*`

Expected result: build/check/test passes before database migration or deployment

## 2. Eligibility gate

### Eligible device

Input:

```json
{
  "platform": "android",
  "appVersion": "1.0.23",
  "appFlavor": "web-production",
  "nativeGeneration": null,
  "ownershipType": "company_financed",
  "enrollmentMode": "android_enterprise_device_owner",
  "isDeviceOwner": true,
  "capabilities": ["mdm_core", "remote_lock", "location", "remote_support", "app_install", "app_uninstall", "policy_sync"]
}
```

Expected:

- [ ] mode = `full_mdm`
- [ ] lock/unlock available
- [ ] location request available
- [ ] remote support available
- [ ] managed app install/uninstall available

### Non-eligible device

Input:

```json
{
  "platform": "android",
  "appVersion": "1.0.21",
  "appFlavor": "web-production",
  "ownershipType": "company_financed",
  "enrollmentMode": "none",
  "isDeviceOwner": false,
  "capabilities": ["mdm_core"]
}
```

Expected:

- [ ] mode = `diagnostics_only`
- [ ] only `diagnostics_ping` available
- [ ] lock/uninstall/location/remote support disabled

## 3. Supabase staging migration

Run migration on staging only first:

- [ ] `mdm_devices` exists
- [ ] `mdm_commands` exists
- [ ] `mdm_command_audit` exists
- [ ] `mdm_remote_support_sessions` exists
- [ ] RLS is enabled on all four tables
- [ ] `mdm_android_1023_web_production_eligible(...)` returns true only for Android 1.0.23 Web Production Device Owner devices

Expected result: non-eligible devices are stored with `is_full_mdm_eligible=false`

## 4. API command validation

Test command request validation before writing to queue:

- [ ] tenant mismatch rejects command
- [ ] device mismatch rejects command
- [ ] unauthorized role rejects command
- [ ] sensitive command without clear reason rejects command
- [ ] command not allowed by device eligibility rejects command
- [ ] accepted command returns audit event payload

Expected result: MDM command rows are never inserted without validation and audit metadata

## 5. Web Production console controls

For eligible Android 1.0.23 Web Production Device Owner device:

- [ ] diagnostics button enabled
- [ ] sync policy button enabled if capability exists
- [ ] lock/unlock button enabled if `remote_lock` exists
- [ ] location button enabled if `location` exists
- [ ] remote support button enabled if `remote_support` exists
- [ ] app install/uninstall button enabled if capability exists
- [ ] sensitive commands require reason
- [ ] owner-level commands display approval requirement

For non-eligible device:

- [ ] only diagnostics button enabled
- [ ] MDM banner shows Diagnostics Only
- [ ] disabled reason is visible to support/admin

## 6. Android 1.0.23 agent

Before executing privileged commands, verify locally on Android:

- [ ] app version is exactly `1.0.23`
- [ ] app flavor is Web Production
- [ ] Device Owner API returns true
- [ ] enrollment mode is Device Owner/Fully Managed/Dedicated Device
- [ ] ownership type is company-owned/company-financed
- [ ] command capability is present
- [ ] command is not expired
- [ ] result is posted back with success/failure audit

Expected result: Android agent refuses privileged commands if local Device Owner state is false

## 7. Regression checks

- [ ] Android `1.0.12 LTS` remains Diagnostics Only
- [ ] Native `2.0` remains Diagnostics Only
- [ ] customer-owned devices remain Diagnostics Only
- [ ] BYOD devices remain Diagnostics Only
- [ ] FF0001-POS-01 style device remains Diagnostics Only until re-enrolled
- [ ] no silent remote screen session is possible
- [ ] no direct uninstall of CpIPOS core agent package is possible

## Safe command examples

Diagnostics-only command:

```json
{
  "commandType": "diagnostics_ping",
  "reason": "Basic support diagnostics"
}
```

Remote support command:

```json
{
  "commandType": "start_remote_support",
  "reason": "Troubleshooting active support case with store operator",
  "payload": {
    "sessionMode": "attended",
    "ttlMinutes": 30
  }
}
```

Financing lock command:

```json
{
  "commandType": "financing_lock",
  "reason": "Installment payment overdue after owner approval and customer notice"
}
```

## Stop conditions

Stop rollout immediately if any of these happen:

- full MDM appears for Android 1.0.12
- full MDM appears for Native 2.0
- full MDM appears for `device_owner=false`
- remote support starts silently
- command queue accepts sensitive commands without reason
- Supabase RLS is disabled or bypassed unexpectedly

# Android Modern 1.0.23 / FF0001 Pilot Checkpoint — 2026-09-01

## Production source

- Production/source branch: `agent/fg-ff-platform-normalization`
- Merged PR: #162
- Squash merge commit: `7acdad8b4a534cb675d961b1cdf75891af67acba`
- Superseded draft PR: #161

## Android customer download lanes

1. **Modern Adaptive 1.0.23 / versionCode 31** — primary customer download. One signed APK supports one or two displays and reports physical display dimensions/capabilities through the Android MDM heartbeat.
2. **Previous Modern 1.0.22 / versionCode 30** — compatibility customer download. Keep the previously published signed APK immutable; do not rebuild code30 with new source.

Legacy Stable 1.0.12 remains a repair-only lane and is not one of the two primary customer downloads.

## Modern 1.0.23 release evidence

Release tag: `android-runtime-modern-1.0.23`

Published assets:
- `CpIPOS-Android-POS-1.0.23.apk`
- `CpIPOS-Android-POS-Modern.apk`
- `CpIPOS-Android-POS-1.0.23.manifest.json`

Published APK SHA-256:
`040c5c7fc80f24e94a40a2ea2bd5b8a6087673b045f38b5de39c9f63bf9c455b`

Expected signing-certificate SHA-256:
`6be0a9aef346a5b47162c8928c5018a01d0e7d81b4eb177bf2fb89922dc2a27a`

The signed-release workflow passed Android unit tests, signing-keystore verification, signed release build, APK package/version/signature verification, artifact upload, and release publication.

## Rollout safety

Modern update offers are emitted only when all existing capability checks pass **and** the paired device has:

`branch_devices.metadata.update_ring = "PILOT"`

This prevents normal Modern terminals from receiving 1.0.23 merely because they are below code31.

The server keeps `mandatory=false`, rejects forced/silent client contracts, and requires the verified staged-updater capability before an interactive staged install can run.

## FF0001 live state at checkpoint

- Tenant code: `FF0001`
- `FF0001-POS-01` is in update ring `PILOT`.
- Last reported runtime before rollout: Modern 1.0.21 / code29.
- Reported display: one physical 1280x800 display; no secondary presentation display.
- Managed updater capability is present, including PackageInstaller, APK SHA-256 verification, and signing-certificate verification.
- Device Owner is false, therefore Android user confirmation is required for installation.
- Do **not** set `branch_devices.is_locked=true` as part of this rollout.

Commercial activation metadata remains prepared with effective date 2026-09-01, `billing_started=false`, and `commercial_activation_required=true`. Activation confirmation must remain a customer action in the native gate and must not modify order/payment history.

## Deployment gate

The application head immediately before the workflow-only release commit passed typecheck, lint, tests, both CpiPOS-001 and CpiPOS-002 schema-drift checks, backoffice build, and both Vercel previews.

The release-only commit and the production merge initially hit Vercel's build-rate limit after several rapid preview builds. This is a deployment-rate gate, not an application-build failure.

## Immediate next action

1. Wait for a production Vercel deployment of `agent/fg-ff-platform-normalization` to complete successfully.
2. Verify `https://cp-ipos-web.vercel.app/download/android/modern-latest/manifest` returns Modern `1.0.23`, versionCode `31`.
3. Only after step 2, set the FF0001 pilot device's `android_update_policy` to verified interactive `staged` install.
4. Re-read FF0001 device telemetry until update state reaches the Android user-confirmation/install path; do not force or silently install on the current non-Device-Owner terminal.
5. After 1.0.23 reports back, verify the native commercial activation gate is received, then wait for the customer to confirm it.

Do not enable the staged policy while production still advertises Modern 1.0.22, because FF0001-POS-01 is currently on 1.0.21 and could otherwise be offered the wrong pilot target.

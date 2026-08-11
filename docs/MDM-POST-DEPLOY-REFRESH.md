# Android POS MDM Post-Deploy Refresh

Last updated: 2026-08-11
Owner direction: after every completed CpIPOS product code/UI improvement that is deployed to production, trigger the Android POS MDM Lite WebView refresh once.

## Required workflow

1. Finish the intended code/UI/API change batch.
2. Run the relevant validation/build checks.
3. Push the completed change batch and wait for the Vercel production deployment to report `READY`.
4. Bump `MDM_RELOAD_GENERATION_MS` once in:
   `apps/backoffice-web/src/app/api/android-pos/mdm/heartbeat/route.ts`
5. Wait for the MDM refresh deployment to report `READY`.
6. The next Android POS MDM heartbeat receives one allowlisted `reload_webview` command with reason `post_deploy_refresh`.
7. Verify the runtime heartbeat/log when the test POS is online.

## Safety rules

- Use `reload_webview` for the normal post-deploy refresh.
- Do not use `clear_cookies` or `clear_webview_data` as a routine refresh because those actions can destroy login/session state.
- Do not leave a persistent environment `reload_webview` command active; the MDM agent polls periodically and a persistent command can cause a reload loop.
- The server compares the device-reported last reload time against `MDM_RELOAD_GENERATION_MS`, so the same generation is not reissued after the device reports that reload.
- Bump the generation only once per completed product change batch, not for documentation-only commits.

## Current implementation

The heartbeat endpoint is:
`POST /api/android-pos/mdm/heartbeat`

The Android POS MDM Lite agent normally polls every 60 seconds while the POS application is running. If the app/device is offline, the one-time refresh is delivered on the next heartbeat after it comes online.

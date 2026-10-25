# Native POS 2.0 — QR FCM notification handoff (preview branch)

This PR is deliberately NOT deployed. It adds secure device registration and dispatches
Android FCM **data-only high-priority** messages after the canonical QR order,
call-staff and request-checkout writes commit successfully. Duplicate QR requests do
not dispatch again. Backend selects only devices registered for the same tenant/branch.
Mobile validates event/table IDs and deduplicates foreground/background events.

## Required activation (not supplied by code)
1. Create a Firebase project on the free Spark tier and register Android app id
   `com.cpipos.pos.next.dev` for preview testing.
2. Obtain the public Firebase Android `google-services.json` from Firebase Console.
   Put it in Android Native `app/google-services.json` **locally**; do not commit it
   as part of the repo. Google Services Gradle plugin is conditional, so CI builds
   without Firebase config in disabled mode.
3. On the Backend deployment environment, configure secure server-side variables
   `NATIVE_FCM_PROJECT_ID`, `NATIVE_FCM_CLIENT_EMAIL` and
   `NATIVE_FCM_PRIVATE_KEY` (PEM; multiline or escaped newlines).
   Service-account private keys must NEVER be put into the Android project.
4. Apply `20261025070000_native_pos_fcm_device_registrations.sql` on the exact
   intended Supabase data plane (and separate trial plane if applicable).
5. Run controlled preview deployment and authenticate a Native POS device; check
   `PUT /api/pos/native-qr-push-registration` success for its signed POS session.
6. Test in three app states: screen open, app in background, process terminated by
   Android while Google Play Services is healthy. Test order, call staff, checkout.
   Explicit user force-stop, OS notification denial, offline device, and OEM power
   saving can delay/prevent display, as per FCM constraints.
7. Verify disabling a POS session / switching branch unregisters the old installation.
   Inspect FCM delivery quotas and errors before production rollout.

No Firebase credentials are available in source. Runtime is disabled until configured,
and this PR must not be promoted automatically. No paid marketing or tools required;
Firebase FCM has a free tier, but usage and hosting quotas still apply.

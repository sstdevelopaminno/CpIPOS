# Android POS WebView Wrapper Status

Last updated: 2026-08-11 03:00 ICT
Owner direction: คุณเอส / CpIPOS
Current assistant role: continue Android POS development only after owner instruction, document every change, and keep continuity across long or restarted chats.

## Current product decision

`CpIPOS POS - Android Tablet` is the active Android POS runtime for near-final POS-machine testing.

The current runtime direction is **Web App wrapper first**:

- Android package: `com.cpipos.pos`
- Source module: `apps/pos-android`
- Current test release: `0.2.1` / `versionCode = 4`
- Web entrypoint: `https://cp-ipos-web.vercel.app/login/store`
- Download Center route: `/download/android/latest`
- Release tag: `android-runtime-latest`
- APK asset name: `CpIPOS-Android-debug.apk`
- Latest release purpose: test on the real POS Android machine before final hardening.

The Android POS app must behave as a tablet/POS-machine shell around the CpIPOS Web App login and POS flow. It must not be confused with `apps/cpipos-mobile-android`, Windows POS Runtime, or IT Admin Runtime.

## Download Center rule

Only `CpIPOS POS - Android Tablet` should show as ready for download while this POS-machine testing cycle is active.

The following products must remain marked as developing until they pass separate QA:

- `CpIPOS Mobile - Android`
- `CpIPOS POS - Windows`
- `CpIPOS IT Admin Runtime`

## What changed in v0.2.1

`MainActivity.kt` is now the WebView runtime entrypoint. It loads the CpIPOS Web App login flow and keeps the user inside the Android POS app shell for normal web navigation.

The existing Kotlin/Compose/native API implementation files are intentionally retained in `apps/pos-android`. They are not the primary runtime entrypoint for this test release. Keep them available for later native device work, printer bridge work, offline/cache work, or rollback analysis.

## Current completion status

Owner-provided status: about **90% complete** for Android POS.

Do not mark Android POS as final production-complete yet. The current purpose is to create a fresh APK for POS-machine testing and finish remaining hardware/runtime tasks.

## Last verified release state

As of 2026-08-11 03:00 ICT:

- Android POS version `0.2.1` / `versionCode = 4` has been built by GitHub Actions.
- Workflow `Build CpIPOS Android Tablet POS` run `31425815489` completed successfully.
- Important workflow steps passed: build debug APK, validate APK, upload workflow artifact, and publish latest release download.
- GitHub Release tag `android-runtime-latest` contains the latest `CpIPOS-Android-debug.apk`.
- Vercel Production deployment for commit `4e6512fbe36d9278bf05c5e13bf99159ce6e07b8` is `READY`.
- `/download/android/latest` redirects to the latest Android runtime APK.

## Owner operating rules for all future Android POS work

These rules must be followed by the assistant or any future agent continuing this project:

1. Treat `CpIPOS POS - Android Tablet` as the current primary app under active development.
2. Do not mix Android POS with `CpIPOS Mobile - Android`, Windows POS Runtime, or IT Admin Runtime.
3. Wait for owner instruction before making new functional code changes.
4. Every code change, behavior change, workflow change, release change, or deployment change must be documented in this file or a clearly linked project document.
5. Update documentation in the same working session as the code change. Do not leave documentation for later.
6. Do not claim a task is 100% complete until code, documentation, build checks, APK/release state, and owner-required hardware testing are accounted for.
7. Do not update or ask the owner to sync code into the local computer / VS Code until the relevant task is completed and verified to the agreed level.
8. If a chat becomes too long, restarts, or loses context, read this document first and continue from the current state here.
9. When changing Android POS, inspect only relevant files first to save tokens and avoid unrelated refactors.
10. Keep production/download changes controlled. Publish a new APK only when the owner asks or when the task explicitly requires a test build.

## Required workflow for every future change

Use this process for Android POS work:

1. Confirm the exact task from the owner.
2. Read this document before changing code.
3. Inspect only the relevant files for the requested task.
4. Make the smallest safe change that satisfies the task.
5. Update this document and any directly affected docs.
6. Run or verify the relevant checks/builds.
7. If a new APK is required, bump version appropriately and publish through the Android workflow.
8. Report exact evidence: commit SHA, workflow run, APK version, release asset, Vercel deployment if affected, and remaining work.
9. Only after the task is verified as complete, provide the owner with local VS Code sync commands or next local steps.

## Development direction from here

Next development should continue around real POS-machine readiness, not unrelated product expansion.

Priority areas:

1. Real device smoke test for Android POS v0.2.1.
2. WebView session behavior: cookies, login persistence, branch/device selection, back button, redirect handling, and reconnect behavior.
3. Tablet/POS usability: fullscreen, keep-screen-on, orientation, touch target sizing, Thai font readability, and slow-device performance.
4. POS flow verification inside WebView: store login, branch selection, device selection, shift gate, sales flow, payment flow, receipt preview.
5. Printer work: hardware connection, print bridge design, receipt format, ESC/POS or vendor-specific commands, and real printer proof.
6. Decide final Android printer bridge architecture:
   - WebView JavaScript bridge to native Android printing,
   - local/native print agent bridge, or
   - API-driven print queue with hardware agent.
7. Add/repair diagnostics for POS device identity, session state, and printer status.
8. Prepare signed release build only after debug APK testing and hardware proof are acceptable.

## Definition of 100% for the current Android POS cycle

Android POS should only be called 100% complete for this cycle when all of the following are true:

- Latest APK installs on the real POS Android machine.
- App opens the CpIPOS Web App through the Android wrapper reliably.
- Login, branch, device, session, shift, sales, payment, and receipt flows work on the real device.
- Printer workflow is proven against the real printer hardware required by the owner.
- Remaining UX issues on POS screen size are fixed or explicitly accepted by the owner.
- Documentation is updated with final status, known limits, test evidence, and next release notes.
- The owner confirms the version is ready to sync into local VS Code / computer workflow.

## Remaining work before final release

1. Test `CpIPOS POS - Android Tablet v0.2.1` on the real POS Android device.
2. Verify login, branch selection, device selection, active session, shift gate, POS sales flow, and receipt flow inside WebView.
3. Complete printer work. Printer status is **not complete** until real hardware is tested.
4. Decide the printer bridge architecture for Android POS.
5. Validate device policy, cookie/session behavior, fullscreen/tablet usability, reconnect behavior, and WebView error states.
6. Create a signed release build when ready for non-debug distribution.

## Printer note

Printer work must remain explicitly open. Existing print architecture discussions mention ticket/print-job style flows, but hardware proof is still required. Do not claim printer complete until the APK is tested against actual printer hardware on the POS machine.

## Working memory for future chats and agents

When continuing Android POS work, use this document as the current source of truth.

Treat older statements that describe Android POS as a native Compose POS client as historical implementation detail unless the owner explicitly changes the direction again.

If the chat is restarted, summarize this as the current continuity point:

> Android POS is now a WebView wrapper around the CpIPOS Web App. Current version is v0.2.1 / versionCode 4. It is about 90% complete per owner direction. It is published for testing through `/download/android/latest`. Only Android POS is ready for download; Mobile, Windows, and IT Admin remain developing. Next work should focus on real POS device testing, WebView stability, POS flow verification, and printer hardware integration. Every future change must update documentation before being considered complete.

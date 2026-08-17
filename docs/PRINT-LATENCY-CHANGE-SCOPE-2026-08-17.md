# Measured print latency change scope — 2026-08-17

Production evidence before this change showed queue-to-claim delays from sub-second up to approximately 6.4 seconds. The physical cash-drawer pulse itself completed in roughly 9–18 ms, receipt native render/USB time was roughly 1.8–2.2 seconds, and payment-notice QR native render/USB time roughly 2.8–3.3 seconds.

The implementation deliberately does not globally increase idle polling. It reduces redundant server empty-claim suppression to 250 ms, adds a bounded Android event wake after queue-producing POS calls, prioritizes cash-drawer pulse jobs when receipt and drawer are pending together, and preloads the payment QR before the user presses Print.

Payment-notice layout changes tighten only the whitespace between the final total summary and the QR container; the QR image is not cropped and its quiet zone is preserved.

Android native-runtime changes ship as version 1.0.11 (versionCode 17) while minSdk remains 26. The PR Android gate has already passed print unit tests, version consistency, stable signing validation, signed release assembly, APK certificate verification, and artifact upload for the new native wake implementation.

The web CI gate is rerun after the scoped request-method TypeScript fix so typecheck, lint, unit tests, both schema-drift checks, and the production-mode web build validate the final PR head before merge.

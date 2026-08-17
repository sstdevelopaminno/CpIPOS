# Print latency and stability — 2026-08-17

Production print-job timing showed the main click-to-action delay before claim, not in the drawer pulse itself. This change therefore keeps idle polling conservative and adds a bounded native wake only after queue-producing POS actions.

Changes: server empty-claim suppression 1500ms → 250ms; Android native print wake (0ms + 350ms retry); cash-drawer claim priority; payment QR data prefetch/cache; tighter payment-notice QR spacing; Android runtime version 1.0.11 with minSdk 26 unchanged.

Security and routing contracts remain unchanged: the browser bridge only wakes the existing authenticated native agent and cannot submit print payloads; database claim scope still requires tenant, branch, agent, eligible printer assignment, retry and lease checks.

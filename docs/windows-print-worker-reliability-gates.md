# Windows print worker reliability and independent transport release gates

## Current contract
- Web POS owns authenticated, device-scoped claims. Windows native bridge owns serialized physical spool submission.
- Existing Windows agent uses a persisted pre-spool job ledger, a server lease/attempt ID and a 150-second age guard. A spool ACK is not a physical-output guarantee.
- Production database inspection confirmed that app.ack_print_job_v2 accepts repeat ACK for the same printed job/agent/attempt and rejects a changed or expired unprinted attempt. Only ACK of a confirmed spool may be retried; no physical replay.

## Independent native background worker (future implementation, not enabled)
1. Device enrollment must issue revocable, short-lived, narrowly scoped credentials after authenticated pairing. Do not export WebView cookies, POS sessions, service-role keys or per-launch loopback tokens to a background service.
2. Server must enforce mutually exclusive ownership for a tenant/branch/device and authorized printer profile. Explicit migration/opt-in must disable the web claimant before a native claimant starts; do not use two agents in parallel.
3. Native worker should durably persist job/attempt intent before the spool call and spool acceptance afterward, distinguish unknown from confirmed acceptance, and reconcile only ACKs tied to the same attempt. Expired/unknown outcomes require review; never delete ledger or reissue physical jobs blindly.
4. Use one bounded queue, request timeouts, capped backoff and network-resume notification. No always-on global fast polling. Keep renderer recovery and cashier UI navigation independent.
5. Add versioned client telemetry and server-side readiness, queue age and lease-expiry metrics; never equate enrollment with connectivity.
6. Pilot on a separate Windows test device with a real POS-80C printer before enabling a customer. Test power/sleep, network interruptions at claim/spool/ACK, app crashes, session revocation, duplicate claims, print spooler stalls, 58/80mm paper and multi-tenant boundaries. Confirm physical output, not just database ACK.
7. Roll back by revoking native ownership and returning to the web claimant after in-flight leases are reconciled; never reset a live queue to pending.

## Production change gates
Keep native installer QA and Web POS production releases separate. Do not force-refresh during an active sale or reopen closed shifts. Read-only observation of customer queue/heartbeats is acceptable; do not create test jobs or change existing printer settings on customer machines without their coordination.

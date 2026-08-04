# CpIPOS Windows Runtime Heartbeat Sender

## Purpose

This phase connects the Windows Runtime to the Device Heartbeat API foundation. The runtime now injects a fail-soft WebView2 heartbeat sender into the CpIPOS web app shell.

The sender periodically reports device diagnostics to:

```text
POST /api/pos/device-heartbeat
```

The request uses the authenticated POS web session in the WebView (`credentials: include`). The server still resolves tenant, branch, POS session, and POS device scope from the session guard. The runtime does not decide its own tenant or branch.

## Signals sent in this phase

The heartbeat sender collects only operational diagnostics required for POS after-sales support:

- Windows Runtime identity
- local generated machine id
- device code fallback
- browser/WebView online state
- Local Bridge `/health` state
- selected/default printer state from bridge health
- print and drawer counters from bridge health
- last print and drawer timestamps
- fail-soft offline sale queue counters from localStorage when present

## Frequency

- Startup heartbeat after 15 seconds
- Interval heartbeat every 5 minutes
- Additional heartbeat on online/offline events
- Additional heartbeat when the WebView becomes visible again
- Minimum gap protection: 60 seconds between non-startup sends

## Fail-soft behavior

Heartbeat must never block POS operation.

If any of these fail, the sender stores a small local status flag and returns silently:

- Local Bridge health fetch
- heartbeat POST
- browser storage access
- JSON response parsing

The POS sale, receipt, printer, and cash drawer flows must continue to work even if heartbeat fails.

## Safety boundary

This phase does not add:

- screen capture
- key logging
- private file inspection
- remote control
- process scanning
- arbitrary command execution

Those features must remain out of scope unless explicit consent, audit logging, and role-based IT permissions are designed in a later phase.

## Next phase

Recommended next phase:

```text
IT Device Health Center read-only dashboard
```

The dashboard should read from the latest heartbeat tables and show branch/device status, incidents, printer health, drawer health, and offline sync risk.

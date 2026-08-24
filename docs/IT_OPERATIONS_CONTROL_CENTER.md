# CpIPOS IT Operations Control Center

## Purpose

One IT backoffice for store registry, 24/7 fleet health, MDM support, incidents and controlled provisioning across product lines.

## Product lines

- `FG####` — Restaurant QR naming family.
- `FF####` — Buffet naming family.
- Prefix classification is display/naming only. Product activation remains explicit and must not use a wildcard prefix gate.

## Phase 1 — Read-only operations center

Route: `/it-admin/operations`

Shows:

- active/inactive stores;
- Store Code and naming family;
- package, branch, device and session summary;
- live/stale POS heartbeat;
- Print Agent heartbeat;
- pending/retrying print backlog;
- unresolved device incidents;
- recent QR failures;
- `FF0001` collision/availability gate.

No write actions are exposed in Phase 1.

## Phase 2 — Controlled provisioning

IT Admin only:

1. choose product profile (`RESTAURANT_QR`, `BUFFET`, later `RETAIL`);
2. allocate next Store Code through a collision-safe server transaction;
3. create tenant/branch/package linkage in `PROVISIONING` state;
4. create table/device/printer slots without fake hardware identities;
5. require preflight/postflight read-back;
6. audit every mutation.

Provisioning must be idempotent and fail closed. No prefix wildcard may activate product features.

## Phase 3 — MDM control center

Default target path:

`Store -> Branch -> Device`

Requirements:

- exact device targeting by default;
- no global broadcast action in the normal UI;
- command preview showing target count before dispatch;
- device signing/version/runtime/heartbeat/display/printer inventory;
- update rings: `LAB`, `PILOT`, `PRODUCTION`, `PRODUCTION_PROTECTED`;
- protected stores require additional confirmation;
- all actions written to audit log.

## Phase 4 — Incident center

Alert sources:

- POS/MDM heartbeat stale;
- Print Agent stale;
- print backlog/failures;
- QR submission failures/duplicates;
- popup backlog;
- payment failures;
- API 5xx;
- runtime/printer/display critical health.

Incidents must be tenant/branch/device scoped and support acknowledge, assign, contain and resolve lifecycle.

## Safety rules

- Never mutate live orders/payments/shifts to make monitoring green.
- Never auto-reassign printers silently.
- Never reuse tenant/branch/device IDs between stores.
- Restaurant QR and Buffet web deployments remain separate.
- Android Shared Runtime can remain common while native hardware contracts match.
- Any production write requires explicit IT Admin authorization, audit evidence and read-back.

# CpIPOS Tenant Data Lifecycle

Date: 2026-08-08
Status: Production control-plane baseline implemented; Trial Supabase project not yet connected to this workspace.

## Goal

Keep the customer-facing store identity stable while allowing CpIPOS to separate trial traffic, paid production traffic, and long-term archives without changing Android, Windows, Web, Mobile, or IT Backoffice login contracts.

## Core rule

A tenant UUID and its six-digit store access code are permanent identifiers. Moving business data between Trial and Primary must never change either identifier.

The six-digit store code is an identifier, not an authentication secret. Employee verification, PIN/staff-card policy, registered device policy, POS session validation, tenant/branch scoping, feature gates, audit logging, and rate limiting remain authoritative security layers.

## Store code ranges

- `100000-799999`: real customer lifecycle. Allocate randomly on the first trial/onboarding and keep forever after conversion to paid.
- `800000-899999`: internal/test tenants only.
- `900000-999999`: Sales/IT demo tenants only.

Current pre-launch mappings:

- `900001` -> legacy `NDL-TH-001` -> Sales/IT demo -> current data home `primary`
- `800001` -> legacy `BBQ-TH-002` -> internal trial -> current data home `primary`, desired `trial`
- `800002` -> legacy `TEST-TH-003` -> internal trial -> current data home `primary`, desired `trial`

Legacy codes remain internal compatibility identifiers. New customer-facing workflows should use the six-digit code.

## Database roles

### Database 1: Primary + Control Plane

Database 1 remains authoritative for identity and routing even when a tenant's high-volume trial business data later moves to Database 2.

Keep authoritative control-plane data here:

- tenant UUID and internal tenant record
- `tenant_access_codes`
- `tenant_data_lifecycle`
- subscription/package state
- Supabase Auth
- user/profile and role authority
- branch/device/login policy authority
- POS session and security/audit control state where required by the central login gateway
- production business data for paid tenants

### Database 2: Trial Data Plane

Database 2 is for trial/high-churn business data after it is connected and schema-verified. It must not become the authority for customer identity or store-code allocation.

Trial data-plane candidates include:

- products/categories used by the trial store
- ingredients/recipes/inventory state
- tables/floor-plan business state
- orders/order items
- payments/payment intents
- stock movements
- trial operational history

Reference rows required by foreign keys may be mirrored into Database 2, but Database 1 remains authoritative for control-plane identity and access.

### Cold Archive

Cold archive is separate from Database 2. Old transaction history should eventually be exported to encrypted object storage with a manifest/checksum rather than consuming live PostgreSQL capacity indefinitely.

Archive candidates include old:

- orders/order items
- payments
- stock movements
- print jobs
- login attempts
- telemetry/performance events
- low-value operational audit data subject to the retention policy

Never archive away current tenant, branch, user, product configuration, subscription, current inventory balance, or data required to operate the live store.

## Routing state

`tenant_data_lifecycle.data_home` is the authoritative current business-data location.

Possible homes:

- `primary`
- `trial`
- `archive`

`desired_data_home` is only a migration target. It must never route live traffic by itself.

Migration states:

- `idle`
- `planned`
- `copying`
- `verifying`
- `cutover`
- `complete`
- `failed`

The runtime router must fail closed if `data_home=trial` but Trial DB credentials/configuration are unavailable. It must never silently write that tenant back to Primary because that creates split-brain data.

## Trial -> Paid conversion

A paid conversion must be orchestrated, not implemented as manual copy/paste.

1. Mark migration `planned`.
2. Establish a short mutation fence/maintenance window for that tenant.
3. Snapshot the Trial data.
4. Copy by dependency order while preserving all UUIDs and idempotency keys.
5. Verify row counts and integrity.
6. Verify financial totals, payment totals, order totals, inventory reconciliation, and required checksums.
7. Mark `verifying` only after copy completes.
8. Perform cutover only after verification passes.
9. Change `data_home` atomically to `primary`, increment routing version, then mark migration complete.
10. Revoke/reissue runtime sessions when required so cached routing/session state cannot continue writing to the old home.
11. Keep the source Trial snapshot for a rollback retention window before purge.

Never change the tenant UUID or six-digit store access code during this process.

## Trial expiry

Recommended lifecycle:

- Trial active
- Trial expired -> restricted/grace state
- Grace/retention window
- Convert to paid or archive
- Purge Trial live data only after a verified archive/snapshot exists and the retention rule permits deletion

Do not automatically delete a tenant immediately at trial expiry.

## API architecture

Clients must call CpIPOS server APIs rather than choosing a Supabase project themselves.

Desired path:

`Android / Windows / Web / Mobile -> CpIPOS API -> trusted session scope -> tenant data router -> Primary or Trial`

Rules:

- never accept trusted `tenant_id`, `branch_id`, or `data_home` from the browser
- derive tenant from the server session/context
- resolve `data_home` on the server
- service-role keys remain server-only
- money-changing mutations stay transaction-RPC-first and idempotent
- timeout does not mean a mutation was cancelled; retry only with the same request/idempotency key
- external provider calls use bounded timeouts and validated HTTPS destinations
- public/auth endpoints remain distributed-rate-limited in Production

## Performance

Do not make every request perform multiple control-plane lookups indefinitely.

Routing metadata is small and may be cached server-side by `tenant_id + routing_version`, with a short TTL and explicit invalidation at cutover. A migration/cutover must invalidate route caches before traffic is released.

The main performance target is reducing network round trips and polling/write amplification. Do not add every Advisor-recommended index mechanically; use measured workload evidence.

## Offline and network-loss behavior

### Windows/native runtime

CpIPOS already has a native desktop offline-sync foundation. Extend that existing idempotent queue instead of creating a second incompatible offline subsystem.

Required rules:

- locally queue mutations with immutable request IDs
- preserve original tenant/branch/device/user/session scope evidence
- retry with the same request ID
- ordered replay where business dependencies require it
- server rejects scope mismatch or duplicate replay safely
- UI clearly shows Online / Offline / Syncing / Sync failed
- payment operations that cannot be safely proven offline must not be fabricated as successful

### Web/Mobile/Android WebView

Until a fully tested offline sales queue exists, treat network loss as a degraded/read-only condition rather than pretending a sale reached the server.

Required UX:

- fast connectivity state indication
- bounded request timeout
- no infinite spinner
- safe retry button
- preserve cart/draft locally where appropriate
- never create a new mutation idempotency key just because the previous request timed out

## Database/provider outage

If Primary or Trial is unavailable:

- fail closed for authenticated mutations that cannot establish trusted scope/data home
- do not fallback a tenant to another database automatically
- keep safe local drafts/queues where the runtime supports it
- surface a clear service status to POS operators
- resume using the same idempotency keys after connectivity returns

## Backup and disaster recovery

Database 2 is not a backup for Database 1.

Maintain separate backup procedures:

- scheduled PostgreSQL logical dump/export
- encrypted off-site storage
- Storage object backup where applicable
- restore drill to a disposable environment
- checksum/row-count verification
- documented RPO/RTO target as customer volume grows

When the Production project moves to a paid Supabase plan, use platform backups/PITR capabilities appropriate to the plan, but retain an independent off-site recovery path for critical customer data.

## Activation gate for Trial DB routing

Do not set any tenant `data_home='trial'` until all are true:

1. Trial Supabase project is connected/visible to the deployment process.
2. Required schema/migrations are applied and verified.
3. Server-only `TRIAL_SUPABASE_URL` and `TRIAL_SUPABASE_SERVICE_ROLE_KEY` exist in Production.
4. `TRIAL_DATA_ROUTING_ENABLED=true` only after a connection/health check passes.
5. Trial DB RLS/grants/security-definer audit passes.
6. Cross-database copy + verification dry run passes using non-customer data.
7. Android, Windows, Web, Mobile, and IT Backoffice continue to use the same CpIPOS API contracts.

Until then, `data_home=primary` remains authoritative for all existing tenants.

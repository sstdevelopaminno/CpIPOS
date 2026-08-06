# POS Stress Checklist + Guards

## 1) Timeout Policy
- `POS_TIMEOUT_ORDER_CREATE_MS` (default `15000`)
- `POS_TIMEOUT_PAYMENT_COMPLETE_MS` (default `15000`)
- Client request timeout for POS monitor/sales/tables should stay <= 20s.
- On timeout, API must return retry-safe error (`504`) and keep idempotency key behavior.

## 2) Queue Depth Guard
- `POS_ORDER_QUEUE_HARD_LIMIT` (default `120`)
- `POS_PRINT_QUEUE_HARD_LIMIT` (default `250`)
- Block new POS order creation when queued orders exceed limit (`429`).
- Allow payment completion even if print queue is overloaded, but return warning and log dead-letter.

## 3) Dead-letter (Payment / Print / Order)
- All timeout/failure paths log to `audit_logs` with actions:
  - `pos_order_dead_letter`
  - `pos_payment_dead_letter`
  - `pos_print_dead_letter`
- Include:
  - `tenant_id`, `branch_id`, `target_id`
  - reason code
  - request/idempotency reference
  - timeout ms or error detail

## 4) Realtime Branch Monitor
- Endpoint: `GET /api/pos/monitor`
- Tenant summary endpoint: `GET /api/admin/pos/monitor`
- Retry endpoints:
  - `POST /api/admin/pos/monitor/retry-all` body `{ "queue": "order" | "payment" }`
- Incident export:
  - `GET /api/admin/pos/incidents/export?date=YYYY-MM-DD`
- Poll interval: `NEXT_PUBLIC_POS_MONITOR_POLL_MS` (default `30000`, clamped to `15000`-`120000`)
- Track per branch:
  - queued orders
  - stale queued orders
  - print queue depth
  - recent failed prints
  - recent dead-letter count
- Render level:
  - `ok`
  - `warn`
  - `critical`

## 5) Load Test Scenarios
- Burst create orders: 30/60/120 concurrent requests with unique idempotency keys.
- Duplicate click: same idempotency key, 5 retries, assert no duplicated order.
- Payment retry: timeout + resend same payment key, assert no double payment.
- Print outage simulation: printer disabled/network down, assert payment still succeeds and dead-letter increments.
- Multi-branch isolation: run same tests on 2+ branches simultaneously and verify queue counters are isolated per branch.

## 6) Operational Alerts
- Alert when `monitor.level = critical` for > 1 minute.
- Alert when stale queued orders > 0 for > 3 minutes.
- Alert when dead-letter count grows continuously within 15 minutes.

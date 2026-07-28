# API Route Design

Base: `apps/backoffice-web/src/app/api`

## Back Office endpoints
- `POST /api/backoffice/orders`
  - Create POS order and manual delivery order payload.
  - Fields include `channel`, `external_order_code`, order totals, and item list.

- `POST /api/backoffice/approvals/pin`
  - Validate manager/owner PIN.
  - Returns approval context for privileged workflows.

- `POST /api/backoffice/stock/adjust`
  - Create stock adjustment movement.
  - Requires `approval_id` for manual adjustment.

- `POST /api/backoffice/shifts/close`
  - Close shift with validation for unpaid dine-in bills and cash mismatch.
  - Requires manager override approval when violations exist.

## IT Admin endpoints
- `POST /api/it-admin/tenants`
  - Activate/create new tenant and package link.

## IT Backoffice API next design
- See `docs/IT-BACKOFFICE-API-DESIGN-2026-07-28.md`.
- Current platform UI routes live under `/api/it-admin/admin/*`.
- Future stable facade should use `/api/it-admin/v1/*` while reusing shared service logic.
- All list endpoints must be paginated for multi-tenant/multi-branch scale.
- Tenant summary aggregation should move to a DB view/RPC instead of app-memory aggregation.
- Phase 1 local implementation adds `/api/it-admin/v1/health`, `/api/it-admin/v1/tenants`, `/api/it-admin/v1/packages`, v1 facades for existing tenant branch/user/device/contract/feature operations, and a tenant summary RPC migration. Not deployed until commit/push/deploy and production migration are run.

## Contract endpoint
- `GET /api/contracts`
  - Machine-readable contract summary for Android POS integration.

## Planned next endpoints
- `POST /api/backoffice/orders/{id}/cancel`
- `POST /api/backoffice/shifts/open`
- `GET /api/backoffice/reports/sales`
- `GET /api/backoffice/reports/stock`
- `GET /api/backoffice/reports/audit`
- `POST /api/qr-login/sessions`

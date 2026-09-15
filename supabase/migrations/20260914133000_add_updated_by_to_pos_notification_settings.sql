-- Keep POS notification / QR kitchen automation settings aligned with the application write contract.
-- The service records the user responsible for the latest settings update.

alter table public.tenant_pos_notification_settings
  add column if not exists updated_by uuid null;

comment on column public.tenant_pos_notification_settings.updated_by is
  'User ID that most recently updated POS notification and QR kitchen automation settings.';

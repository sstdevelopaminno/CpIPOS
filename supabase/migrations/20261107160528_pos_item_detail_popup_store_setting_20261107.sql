-- Per-branch opt-out for the sales item-detail popup.
-- Existing stores retain the current behavior until a manager switches it off.
alter table public.tenant_pos_notification_settings
  add column if not exists pos_item_detail_popup_enabled boolean not null default true;

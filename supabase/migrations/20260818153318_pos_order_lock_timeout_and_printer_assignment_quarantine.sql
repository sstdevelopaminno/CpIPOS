alter function app.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text)
  set search_path = 'pg_catalog','public','app','extensions';
alter function app.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text)
  set lock_timeout = '5s';

alter function public.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text)
  set search_path = 'pg_catalog','public','app','extensions';
alter function public.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text)
  set lock_timeout = '5s';

alter function app.lock_dine_in_order_table_session_before_insert() set lock_timeout = '5s';

update public.printer_device_assignments a
set is_enabled=false,
    is_default=false,
    updated_at=now()
from public.printer_devices d
where d.id=a.printer_device_id
  and d.tenant_id=a.tenant_id
  and d.branch_id=a.branch_id
  and a.is_enabled=true
  and d.is_active=false
  and d.printer_profile_id is null;

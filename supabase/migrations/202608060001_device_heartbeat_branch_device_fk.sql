-- MDM Phase A: link device heartbeat tables to the branch_devices registry.
-- pos_device_id on all three heartbeat tables has been populated from
-- pos_sessions.device_id (itself `references branch_devices(id)`) since the
-- heartbeat foundation migration, so no existing row can violate this FK.

alter table public.pos_device_health_latest
  add constraint pos_device_health_latest_pos_device_id_fkey
  foreign key (pos_device_id) references public.branch_devices(id) on delete set null;

alter table public.pos_device_health_snapshots
  add constraint pos_device_health_snapshots_pos_device_id_fkey
  foreign key (pos_device_id) references public.branch_devices(id) on delete set null;

alter table public.pos_device_incidents
  add constraint pos_device_incidents_pos_device_id_fkey
  foreign key (pos_device_id) references public.branch_devices(id) on delete set null;

create index if not exists pos_device_health_latest_pos_device_id_idx
  on public.pos_device_health_latest (pos_device_id)
  where pos_device_id is not null;

create index if not exists pos_device_health_snapshots_pos_device_id_idx
  on public.pos_device_health_snapshots (pos_device_id)
  where pos_device_id is not null;

create index if not exists pos_device_incidents_pos_device_id_idx
  on public.pos_device_incidents (pos_device_id)
  where pos_device_id is not null;

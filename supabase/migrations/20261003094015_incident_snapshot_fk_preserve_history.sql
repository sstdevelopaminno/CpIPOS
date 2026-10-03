-- Preserve incident lifecycle when historical device-health snapshots are purged.
alter table public.pos_device_incidents
  drop constraint if exists pos_device_incidents_snapshot_id_fkey;

alter table public.pos_device_incidents
  add constraint pos_device_incidents_snapshot_id_fkey
  foreign key (snapshot_id)
  references public.pos_device_health_snapshots(id)
  on delete set null;

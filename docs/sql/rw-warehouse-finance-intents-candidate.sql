-- UAT accounting reconciliation, not a GL posting migration.
-- Each movement yields at most one balanced internal reclassification intent.
-- Inbound requires a verified purchasing source document and is kept unposted.
begin;
create view public.rw_warehouse_finance_intents_candidate with (security_invoker=true) as
select l.tenant_id,l.id as ledger_id,l.request_id,l.warehouse_id,l.sku,l.transfer_id,
 t.destination_branch_id,l.event,l.created_at,
 case l.event when 'dispatch' then 'inventory_in_transit' when 'branch_receipt' then 'branch_inventory' else 'warehouse_inventory' end as debit_bucket,
 case l.event when 'dispatch' then 'warehouse_inventory' when 'branch_receipt' then 'inventory_in_transit' else null end as credit_bucket,
 case l.event when 'dispatch' then l.transit_value_delta when 'branch_receipt' then l.branch_value_delta else l.warehouse_value_delta end as amount_minor,
 case when l.event='warehouse_receipt' then 'source_document_required'
      when l.warehouse_value_delta=0 and l.transit_value_delta=0 and l.branch_value_delta=0 then 'zero_value'
      else 'account_mapping_required' end as posting_status
from public.rw_warehouse_ledger l left join public.rw_warehouse_transfers t on t.tenant_id=l.tenant_id and t.id=l.transfer_id;
revoke all on public.rw_warehouse_finance_intents_candidate from public,anon,authenticated,service_role;
grant select on public.rw_warehouse_finance_intents_candidate to service_role;
commit;

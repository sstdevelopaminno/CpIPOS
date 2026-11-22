-- Accounting-controlled, immutable, tenant-scoped Recycling tax invoice issue.
-- Caller is service_role only; API must separately validate a manager PIN.
begin;
create or replace function public.recycling_issue_tax_invoice(
  p_tenant_id uuid,p_branch_id uuid,p_transaction_id uuid,
  p_profile_id uuid,p_issued_by uuid,p_buyer_branch_no text
) returns jsonb language plpgsql security invoker set search_path='' as $issue$
declare
 v_tx public.recycling_transactions%rowtype;
 v_issuer public.recycling_vat_issuers%rowtype;
 v_profile public.pos_tax_invoice_profiles%rowtype;
 v_existing public.recycling_tax_invoices%rowtype;
 v_seq bigint;
 v_items jsonb;
 v_id uuid;
 v_no text;
 v_sale_date date;
begin
 if p_buyer_branch_no is null or p_buyer_branch_no !~ '^[0-9]{5}$' then
   raise exception 'recycling_tax_buyer_branch_required';
 end if;
 if not exists(select 1 from public.user_branch_roles where
   tenant_id=p_tenant_id and branch_id=p_branch_id and user_id=p_issued_by
   and role::text in ('owner','manager')) then
   raise exception 'recycling_tax_issuer_role_denied';
 end if;
 -- A transaction row lock serializes concurrent requests for the same sale.
 select * into v_tx from public.recycling_transactions
  where id=p_transaction_id and tenant_id=p_tenant_id and branch_id=p_branch_id
  for update;
 if not found or v_tx.direction<>'sell' or v_tx.status<>'posted'
    or v_tx.tax_state is distinct from 'vat_recorded'
    or v_tx.vat_minor is null or v_tx.base_minor is null
    or v_tx.base_minor + v_tx.vat_minor<>v_tx.total_minor then
   raise exception 'recycling_tax_transaction_not_eligible';
 end if;
 select * into v_existing from public.recycling_tax_invoices
  where transaction_id=p_transaction_id;
 if found then
   if v_existing.profile_id<>p_profile_id then
     raise exception 'recycling_tax_invoice_already_issued_to_other_buyer';
   end if;
   return jsonb_build_object('id',v_existing.id,
     'invoice_no',v_existing.invoice_no,'idempotent',true);
 end if;
 v_sale_date:=(v_tx.created_at at time zone 'Asia/Bangkok')::date;
 -- Same-day tax-point issuance; older sales require accountant review.
 if v_sale_date<>(now() at time zone 'Asia/Bangkok')::date then
   raise exception 'recycling_tax_invoice_late_issue_requires_accountant_review';
 end if;
 select * into v_issuer from public.recycling_vat_issuers
  where tenant_id=p_tenant_id and branch_id=p_branch_id
   and active and verified_at is not null
   and verified_from<=v_sale_date and verified_from<=(now() at time zone 'Asia/Bangkok')::date
   and (verified_until is null or verified_until >= (now() at time zone 'Asia/Bangkok')::date)
   for share;
 if not found then raise exception 'recycling_vat_registration_not_verified'; end if;
 if v_tx.tax_snapshot->'seller'->>'tax_id' is distinct from v_issuer.tax_id
   or v_tx.tax_snapshot->'seller'->>'display_name' is distinct from v_issuer.legal_name
   or v_tx.tax_snapshot->'seller'->>'address' is distinct from v_issuer.legal_address
   or v_tx.tax_snapshot->'seller'->>'branch_no' is distinct from v_issuer.branch_no then
   raise exception 'recycling_tax_seller_changed_requires_review';
 end if;
 select * into v_profile from public.pos_tax_invoice_profiles
   where id=p_profile_id and tenant_id=p_tenant_id
     and branch_id=p_branch_id and is_active;
 if not found or length(btrim(v_profile.display_name))=0 or
   length(btrim(v_profile.address_line))=0 or
   v_profile.tax_id !~ '^[0-9]{13}$' then
   raise exception 'recycling_tax_buyer_profile_invalid';
 end if;
 select jsonb_agg(jsonb_build_object(
    'name',name_snapshot,'sku',sku_snapshot,'quantity',original_quantity,
    'unit',original_unit,'price_per_base',price_per_base,'base_minor',amount_minor)
    order by line_no) into v_items from public.recycling_transaction_lines
   where transaction_id=p_transaction_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
 if v_items is null or
   (select coalesce(sum(amount_minor),0) from public.recycling_transaction_lines
     where transaction_id=p_transaction_id and tenant_id=p_tenant_id
       and branch_id=p_branch_id)<>v_tx.base_minor then
   raise exception 'recycling_tax_items_total_mismatch';
 end if;
 insert into public.recycling_tax_invoice_sequences(tenant_id,last_value)
   values(p_tenant_id,0) on conflict(tenant_id) do nothing;
 update public.recycling_tax_invoice_sequences set last_value=last_value+1
   where tenant_id=p_tenant_id returning last_value into v_seq;
 if v_seq>999999999999 then raise exception 'recycling_tax_invoice_sequence_exhausted'; end if;
 v_no:='RTI-'||lpad(v_seq::text,6,'0');
 insert into public.recycling_tax_invoices
  (tenant_id,branch_id,transaction_id,profile_id,invoice_no,issued_by,
   seller_snapshot,buyer_snapshot,items_snapshot,tax_snapshot)
 values(p_tenant_id,p_branch_id,p_transaction_id,p_profile_id,v_no,p_issued_by,
   v_tx.tax_snapshot->'seller',
   jsonb_build_object('entity_type',v_profile.entity_type,'display_name',v_profile.display_name,
     'tax_id',v_profile.tax_id,'branch_no',p_buyer_branch_no,'address_line',v_profile.address_line,
     'subdistrict',v_profile.subdistrict,'district',v_profile.district,
     'province',v_profile.province,'postal_code',v_profile.postal_code),
   v_items,
   jsonb_build_object('source_transaction',p_transaction_id,
     'receipt_no',v_tx.receipt_no,'sale_at',v_tx.created_at,
     'base_minor',v_tx.base_minor,'vat_minor',v_tx.vat_minor,
     'total_minor',v_tx.total_minor,'rate_pct',v_tx.tax_snapshot->>'rate_pct',
     'mode',v_tx.tax_snapshot->>'mode'))
 returning id into v_id;
 return jsonb_build_object('id',v_id,'invoice_no',v_no,'idempotent',false);
end;
$issue$;
revoke all on function public.recycling_issue_tax_invoice(uuid,uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.recycling_issue_tax_invoice(uuid,uuid,uuid,uuid,uuid,text)
  to service_role;

-- Invoice identity, recipient and tax amounts never change after issuance.
create or replace function public.recycling_tax_invoice_immutable()
returns trigger language plpgsql security invoker set search_path='' as $immutable$
begin
 if old.tenant_id is distinct from new.tenant_id
  or old.branch_id is distinct from new.branch_id
  or old.transaction_id is distinct from new.transaction_id
  or old.profile_id is distinct from new.profile_id
  or old.invoice_no is distinct from new.invoice_no
  or old.seller_snapshot is distinct from new.seller_snapshot
  or old.buyer_snapshot is distinct from new.buyer_snapshot
  or old.items_snapshot is distinct from new.items_snapshot
  or old.tax_snapshot is distinct from new.tax_snapshot
  or old.issued_by is distinct from new.issued_by
  or old.issued_at is distinct from new.issued_at then
    raise exception 'recycling_tax_invoice_immutable';
 end if;
 return new;
end;
$immutable$;
create trigger recycling_tax_invoice_no_mutation
before update on public.recycling_tax_invoices
for each row execute function public.recycling_tax_invoice_immutable();
commit;

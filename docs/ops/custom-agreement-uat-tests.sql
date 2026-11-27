-- Synthetic data; not a production settlement or company signature.
do $$
declare
  pkg uuid:=gen_random_uuid(); a_t uuid:=gen_random_uuid(); b_t uuid:=gen_random_uuid(); c_t uuid:=gen_random_uuid(); d_t uuid:=gen_random_uuid();
  a_owner uuid:=gen_random_uuid(); b_owner uuid:=gen_random_uuid(); c_owner uuid:=gen_random_uuid(); d_owner uuid:=gen_random_uuid();
  ar uuid:=gen_random_uuid(); br uuid:=gen_random_uuid(); cr uuid:=gen_random_uuid(); dr uuid:=gen_random_uuid();
  binding uuid:=gen_random_uuid(); a_id uuid; b_id uuid; a_at timestamptz; b_at timestamptz; paid_at timestamptz; q jsonb; q2 jsonb; blocked boolean;
  terms jsonb:='{"terms_version":1,"max_branches":1}'::jsonb;
  clauses jsonb:='["UAT terms only"]'::jsonb;
  signature text:='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ8AAAAASUVORK5CYII=';
begin
  insert into public.subscription_packages values(pkg,'custom');
  insert into public.tenants values
    (a_t,'UAT-A','UAT-A','UAT ADDRESS A',true,a_owner),(b_t,'UAT-B','UAT-B','UAT ADDRESS B',true,b_owner),
    (c_t,'UAT-C','UAT-C','UAT ADDRESS C',true,c_owner),(d_t,'UAT-D','UAT-D','UAT ADDRESS D',true,d_owner);
  insert into public.it_communication_settings values('default','UAT ISSUER','0000000000000','UAT ISSUER ADDRESS');
  insert into public.line_support_bindings values(binding,b_t,true,b_owner);
  insert into public.tenant_subscription_payment_requests
    select x.r,x.t,pkg,'pending',null,null,'THB',jsonb_build_object('source','it_custom_agreement','kind','payment_notice','expected_amount',x.price,'billing_interval','monthly','custom_terms_snapshot',terms)
    from (values(ar,a_t,1500),(br,b_t,2500),(cr,c_t,900),(dr,d_t,1800)) x(r,t,price);

  if has_table_privilege('anon','public.tenant_custom_agreement_acceptances','SELECT') or
     has_table_privilege('authenticated','public.tenant_custom_agreement_activations','SELECT') or
     has_table_privilege('service_role','public.tenant_custom_agreement_acceptances','UPDATE') or
     has_table_privilege('service_role','public.tenant_custom_agreement_activations','DELETE') then
    raise exception 'unsafe agreement table privileges';
  end if;
  blocked:=false;
  begin
    perform public.custom_agreement_quote_or_accept(b_t,ar,b_owner,'UAT',clauses,'UAT DIRECTOR',null,'pos',null,signature);
  exception when others then blocked:=sqlerrm='agreement_request_not_found'; end;
  if not blocked then raise exception 'cross-tenant request accepted'; end if;

  q:=public.custom_agreement_quote_or_accept(a_t,ar,a_owner,'UAT',clauses,'UAT DIRECTOR',null,'pos',null,signature);
  if q->'snapshot'->>'amount_per_cycle'<>'1500' or q->'snapshot'->>'company_address'<>'UAT ADDRESS A' then raise exception 'quote incorrect'; end if;
  blocked:=false;
  begin
    perform public.custom_agreement_quote_or_accept(a_t,ar,a_owner,'UAT',clauses,'UAT DIRECTOR',jsonb_set(q->'snapshot','{amount_per_cycle}','1'),'pos',null,signature);
  exception when others then blocked:=sqlerrm='agreement_quote_changed'; end;
  if not blocked then raise exception 'modified quote accepted'; end if;
  q2:=public.custom_agreement_quote_or_accept(a_t,ar,a_owner,'UAT',clauses,'UAT DIRECTOR',q->'snapshot','pos',null,signature);
  a_id:=(q2->>'id')::uuid; a_at:=(q2->>'accepted_at')::timestamptz;
  q2:=public.custom_agreement_quote_or_accept(a_t,ar,a_owner,'UAT',clauses,'UAT DIRECTOR',q->'snapshot','pos',null,signature);
  if (q2->>'id')::uuid is distinct from a_id then raise exception 'acceptance retry not idempotent'; end if;
  if exists(select 1 from public.tenant_custom_agreement_activations where tenant_id=a_t) then raise exception 'acceptance alone activated'; end if;

  blocked:=false;
  begin
    perform public.custom_agreement_quote_or_accept(b_t,br,a_owner,'UAT',clauses,'UAT DIRECTOR',null,'line',binding,signature);
  exception when others then blocked:=sqlerrm='agreement_actor_invalid'; end;
  if not blocked then raise exception 'invalid LINE binding accepted'; end if;
  q:=public.custom_agreement_quote_or_accept(b_t,br,b_owner,'UAT',clauses,'UAT DIRECTOR',null,'line',binding,signature);
  q2:=public.custom_agreement_quote_or_accept(b_t,br,b_owner,'UAT',clauses,'UAT DIRECTOR',q->'snapshot','line',binding,signature);
  b_id:=(q2->>'id')::uuid; b_at:=(q2->>'accepted_at')::timestamptz;
  if not exists(select 1 from public.tenant_custom_agreement_acceptances where id=b_id and acceptance_channel='line' and line_binding_id=binding) then raise exception 'LINE evidence not stored'; end if;

  -- Payment before acceptance cannot activate.
  insert into public.tenant_subscription_settlements(tenant_id,payment_request_id,package_id,billing_interval,amount_received,currency,bank_received_at)
    values(a_t,ar,pkg,'monthly',1500,'THB',a_at-interval '1 second');
  if exists(select 1 from public.tenant_custom_agreement_activations where tenant_id=a_t) then raise exception 'retrospective activation'; end if;
  -- First real settlement after valid acceptance activates once for 12 months.
  paid_at:=a_at+interval '1 second';
  insert into public.tenant_subscription_settlements(tenant_id,payment_request_id,package_id,billing_interval,amount_received,currency,bank_received_at)
    values(a_t,ar,pkg,'monthly',1500,'THB',paid_at),(b_t,br,pkg,'monthly',2500,'THB',b_at+interval '1 second');
  if not exists(select 1 from public.tenant_custom_agreement_activations where acceptance_id=a_id and starts_at=paid_at
    and ends_at=((paid_at at time zone 'Asia/Bangkok')+interval '12 months') at time zone 'Asia/Bangkok') then raise exception 'incorrect commitment dates'; end if;
  if not exists(select 1 from public.tenant_custom_agreement_activations where acceptance_id=b_id) then raise exception 'LINE settlement did not activate'; end if;
  insert into public.tenant_subscription_settlements(tenant_id,payment_request_id,package_id,billing_interval,amount_received,currency,bank_received_at)
    values(a_t,ar,pkg,'monthly',1500,'THB',paid_at+interval '1 month'),(c_t,cr,pkg,'monthly',900,'THB',paid_at);
  if (select count(*) from public.tenant_custom_agreement_activations where tenant_id=a_t)<>1 then raise exception 'monthly payment restarted commitment'; end if;
  if exists(select 1 from public.tenant_custom_agreement_activations where tenant_id=c_t) then raise exception 'legacy unaccepted payment bound'; end if;

  q:=public.custom_agreement_quote_or_accept(d_t,dr,d_owner,'UAT',clauses,'UAT DIRECTOR',null,'pos',null,signature);
  q2:=public.custom_agreement_quote_or_accept(d_t,dr,d_owner,'UAT',clauses,'UAT DIRECTOR',q->'snapshot','pos',null,signature);
  insert into public.tenant_subscription_settlements(tenant_id,payment_request_id,package_id,billing_interval,amount_received,currency,bank_received_at)
    values(d_t,dr,pkg,'monthly',1700,'THB',clock_timestamp()+interval '1 second');
  update public.tenant_subscription_payment_requests set metadata=jsonb_set(metadata,'{custom_terms_snapshot,terms_version}','2') where id=dr;
  insert into public.tenant_subscription_settlements(tenant_id,payment_request_id,package_id,billing_interval,amount_received,currency,bank_received_at)
    values(d_t,dr,pkg,'monthly',1800,'THB',clock_timestamp()+interval '1 second');
  if exists(select 1 from public.tenant_custom_agreement_activations where tenant_id=d_t) then raise exception 'mismatched price or stale terms activated'; end if;
  raise notice 'CUSTOM agreement UAT: PASS';
end $$;

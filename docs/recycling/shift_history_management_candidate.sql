-- Candidate only: install on disposable PostgreSQL before release.
begin;
create function public.recycling_manage_closed_shift_v1(
 p_session_id uuid,p_shift_id uuid,p_action text,p_version timestamptz,p_reason text,
 p_opened_at timestamptz,p_closed_at timestamptz,p_opening_cash numeric,p_actual_cash numeric
) returns jsonb language plpgsql security invoker set search_path='' as $manage$
declare
 actor public.pos_sessions%rowtype; old_shift public.shifts%rowtype; new_shift public.shifts%rowtype;
 tx_count bigint; cash_in bigint; cash_out bigint; buy_count bigint; sell_count bigint;
 transfer_in bigint; transfer_out bigint; expected_minor bigint; related boolean; dep record;
 event_before jsonb; jobs_before jsonb; j public.print_jobs%rowtype;
begin
 if p_action is null or p_action not in ('edit','delete') or p_version is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'shift_history_invalid'; end if;
 select * into actor from public.pos_sessions where id=p_session_id;
 if not found or actor.status<>'active' or actor.expires_at<=now() or actor.role not in ('owner','manager') then raise exception 'shift_history_forbidden'; end if;
 if not exists(select 1 from public.users_profiles u join public.user_branch_roles r on r.user_id=u.id where u.id=actor.user_id and u.is_active and r.tenant_id=actor.tenant_id and r.branch_id=actor.branch_id and r.role::text in ('owner','manager')) then raise exception 'shift_history_forbidden'; end if;
 -- Serialize with branch FK inserts and the posting/VOID row lock.
 perform 1 from public.branches where id=actor.branch_id and tenant_id=actor.tenant_id for update;
 select * into old_shift from public.shifts where id=p_shift_id and tenant_id=actor.tenant_id and branch_id=actor.branch_id for update;
 if not found or old_shift.status<>'closed' or old_shift.metadata->>'business_shift_mode' is distinct from 'recycling_daily' then raise exception 'shift_history_forbidden'; end if;
 if old_shift.updated_at is distinct from p_version then raise exception 'shift_history_conflict'; end if;
 if exists(select 1 from public.shifts s where s.tenant_id=actor.tenant_id and s.branch_id=actor.branch_id and s.id<>p_shift_id and (s.opened_at>=old_shift.opened_at or s.status='open')) then raise exception 'shift_history_later'; end if;
 select count(*),count(*) filter(where direction='buy' and status='posted'),count(*) filter(where direction='sell' and status='posted'),
 coalesce(sum(total_minor) filter(where direction='sell' and settlement='cash' and status='posted'),0),
 coalesce(sum(total_minor) filter(where direction='buy' and settlement='cash' and status='posted'),0),
 coalesce(sum(total_minor) filter(where direction='sell' and settlement='bank_transfer' and status='posted'),0),
 coalesce(sum(total_minor) filter(where direction='buy' and settlement='bank_transfer' and status='posted'),0)
 into tx_count,buy_count,sell_count,cash_in,cash_out,transfer_in,transfer_out from public.recycling_transactions where shift_id=p_shift_id;
 if exists(select 1 from public.orders where shift_id=p_shift_id) or exists(select 1 from public.payments where shift_id=p_shift_id) or exists(select 1 from public.cash_drawer_events where shift_id=p_shift_id) then raise exception 'shift_history_dependencies'; end if;
 if p_action='edit' then
  if p_opened_at is null or p_closed_at is null or p_opened_at>p_closed_at or p_closed_at>now()
   or p_closed_at>(((p_opened_at at time zone 'Asia/Bangkok')::date+1)::timestamp at time zone 'Asia/Bangkok')
   or p_opening_cash is null or p_actual_cash is null or p_opening_cash not between 0 and 999999999999.99 or p_actual_cash not between 0 and 999999999999.99
   or p_opening_cash<>round(p_opening_cash,2) or p_actual_cash<>round(p_actual_cash,2) then raise exception 'shift_history_invalid'; end if;
  if exists(select 1 from public.shifts s where s.tenant_id=actor.tenant_id and s.branch_id=actor.branch_id and s.id<>p_shift_id and (s.closed_at is null or s.closed_at>p_opened_at)) then raise exception 'shift_history_later'; end if;
  if tx_count>0 and (p_opened_at is distinct from old_shift.opened_at or p_closed_at is distinct from old_shift.closed_at or p_opening_cash is distinct from old_shift.opening_cash) then raise exception 'shift_history_dependencies'; end if;
 else
  if tx_count>0 or (old_shift.actual_cash is not null and old_shift.actual_cash is distinct from old_shift.opening_cash) then raise exception 'shift_history_dependencies'; end if;
 end if;
 -- No source funding adjustment or approval may be bypassed. For a real
 -- transaction, only a separately attested recount is permitted.
 if (p_action='delete' or p_opening_cash is distinct from old_shift.opening_cash or p_opened_at is distinct from old_shift.opened_at or p_closed_at is distinct from old_shift.closed_at) and
 (old_shift.metadata->>'recycling_fund_source'='withdrawn_cash' or nullif(old_shift.metadata->>'recycling_fund_reference','') is not null or old_shift.close_override_approval_id is not null) then raise exception 'shift_history_dependencies'; end if;
 -- Discover additional linked tables including legacy archives, rather than
 -- relying on cascading FK deletion or a zero-sales display.
 if p_action='delete' or p_opening_cash is distinct from old_shift.opening_cash or p_opened_at is distinct from old_shift.opened_at or p_closed_at is distinct from old_shift.closed_at then
  for dep in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=c.oid
   where n.nspname='public' and c.relkind in ('r','p') and a.attname='shift_id' and not a.attisdropped
   and c.relname not in ('recycling_shift_auto_close_events','recycling_transactions') loop
    execute pg_catalog.format('select exists(select 1 from %I.%I where shift_id::text=$1)',dep.nspname,dep.relname) into related using p_shift_id::text;
    if related then raise exception 'shift_history_dependencies'; end if;
  end loop;
 end if;
 select to_jsonb(e) into event_before from public.recycling_shift_auto_close_events e where shift_id=p_shift_id;
 jobs_before:='[]'::jsonb;
 for j in select * from public.print_jobs where tenant_id=actor.tenant_id and branch_id=actor.branch_id
  and (metadata->>'shift_id'=p_shift_id::text or payload_json->>'shift_id'=p_shift_id::text) for update loop
  if p_action='delete' then
   if j.status::text<>'pending' or j.claimed_at is not null or j.printed_at is not null or exists(select 1 from public.print_job_attempts where print_job_id=j.id) or exists(select 1 from public.cash_drawer_events where print_job_id=j.id) then raise exception 'shift_history_print_pending'; end if;
   jobs_before:=jobs_before||jsonb_build_array(to_jsonb(j));
   delete from public.print_jobs where id=j.id;
  elsif j.status::text not in ('printed','failed','cancelled','canceled') or j.claimed_at is not null and j.printed_at is null then raise exception 'shift_history_print_pending';
  end if;
 end loop;
 if p_action='delete' then
  delete from public.recycling_shift_auto_close_events where shift_id=p_shift_id;
  delete from public.shifts where id=p_shift_id;
 else
  expected_minor:=round(p_opening_cash*100)::bigint+cash_in-cash_out;
  if expected_minor<0 then raise exception 'shift_history_invalid'; end if;
  update public.shifts set opened_at=p_opened_at,closed_at=p_closed_at,opening_cash=p_opening_cash,
   actual_cash=p_actual_cash,closing_cash=p_actual_cash,expected_cash=expected_minor::numeric/100,
   closed_by=actor.user_id,updated_at=clock_timestamp(),
   metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'close_reason','recycling_history_corrected','cash_count_required',false,'recycling_requires_cash_review',false,
    'recycling_buy_count',buy_count,'recycling_sell_count',sell_count,'recycling_cash_in_minor',cash_in,'recycling_cash_out_minor',cash_out,'recycling_cash_net_minor',cash_in-cash_out,
    'recycling_transfer_in_minor',transfer_in,'recycling_transfer_out_minor',transfer_out,'recycling_expected_cash_minor',expected_minor,
    'recycling_cash_count_reconciled',round(p_actual_cash*100)::bigint=expected_minor,'recycling_history_corrected_at',now())
  where id=p_shift_id returning * into new_shift;
 end if;
 insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_role,action,target_table,target_id,metadata,before_data,after_data,user_id,role,module,entity_type,entity_id,pos_session_id)
 values(actor.tenant_id,actor.branch_id,actor.user_id,actor.role,'recycling_shift_history_'||p_action,'shifts',p_shift_id,
 jsonb_build_object('reason',btrim(p_reason),'removed_print_jobs',jobs_before,'original_auto_close',event_before),
 to_jsonb(old_shift),case when p_action='edit' then to_jsonb(new_shift) else null end,actor.user_id,actor.role,'recycling_shift','shifts',p_shift_id::text,actor.id);
 return jsonb_build_object('id',p_shift_id,'action',p_action);
end;
$manage$;
revoke all on function public.recycling_manage_closed_shift_v1(uuid,uuid,text,timestamptz,text,timestamptz,timestamptz,numeric,numeric) from public,anon,authenticated;
grant execute on function public.recycling_manage_closed_shift_v1(uuid,uuid,text,timestamptz,text,timestamptz,timestamptz,numeric,numeric) to service_role;
grant delete on public.recycling_shift_auto_close_events to service_role;
commit;

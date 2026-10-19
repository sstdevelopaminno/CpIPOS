-- STAGED ONLY. CUSTOM Optical CRM draft CRUD, separate from live finance and POS cart.
-- Apply only after isolated RLS and transactional tests. No new Supabase project.
begin;
create table if not exists public.optical_work_order_drafts (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  customer_id uuid not null references public.optical_customers(id),
  eye_exam_id uuid null references public.optical_eye_exams(id),
  seller_id uuid null references auth.users(id),
  items jsonb not null default '[]'::jsonb,
  discount_lak numeric(18,0) not null default 0 check (discount_lak>=0),
  due_at timestamptz,
  note text not null default '' check (length(note)<=1000),
  status text not null default 'draft' check (status in ('draft','void','issued')),
  version integer not null default 1 check (version>=1),
  last_request_id uuid not null,
  last_payload_hash text not null,
  issued_order_id uuid references public.optical_work_orders(id),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists optical_work_order_drafts_branch_v1
  on public.optical_work_order_drafts(tenant_id,branch_id,created_at desc);
alter table public.optical_work_order_drafts enable row level security;
revoke all on table public.optical_work_order_drafts from public,anon,authenticated;
grant select on table public.optical_work_order_drafts to authenticated;
create policy optical_work_order_drafts_scope_select_v1
  on public.optical_work_order_drafts for select to authenticated using (
    exists (select 1 from public.users_profiles u
      join public.user_branch_roles r on r.user_id=u.id
      where u.id=auth.uid() and u.is_active and u.archived_at is null
        and r.tenant_id=optical_work_order_drafts.tenant_id
        and r.branch_id=optical_work_order_drafts.branch_id
        and r.role::text in ('owner','manager'))
    or app.crm_staff_permission_allowed(
      tenant_id,branch_id,'main.crm_optical_orders',false)
  );

create table if not exists public.optical_work_order_draft_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  draft_id uuid not null references public.optical_work_order_drafts(id) on delete cascade,
  version integer not null,
  action text not null check (action in ('created','updated','voided','issued')),
  actor_id uuid not null references auth.users(id),
  previous_payload jsonb,
  next_payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.optical_work_order_draft_events enable row level security;
revoke all on table public.optical_work_order_draft_events from public,anon,authenticated;
grant select on table public.optical_work_order_draft_events to authenticated;
create policy optical_work_order_draft_events_scope_select_v1
  on public.optical_work_order_draft_events for select to authenticated using (
    exists(select 1 from public.user_branch_roles r
      join public.users_profiles u on u.id=r.user_id
      where r.user_id=auth.uid() and u.is_active and u.archived_at is null
        and r.tenant_id=optical_work_order_draft_events.tenant_id
        and r.branch_id=optical_work_order_draft_events.branch_id
        and r.role::text in ('owner','manager'))
  );

-- Separate internal business privilege from platform IT technical access.
create or replace function app.optical_crm_draft_write_allowed(
  p_tenant uuid,p_branch uuid
) returns boolean language sql stable security definer
set search_path to 'pg_catalog','public','app' as $fn$
  select auth.uid() is not null
    and exists(select 1 from public.users_profiles u where u.id=auth.uid()
      and u.is_active=true and u.archived_at is null)
    and (
      exists(select 1 from public.user_branch_roles r
        where r.user_id=auth.uid() and r.tenant_id=p_tenant
          and r.branch_id=p_branch and r.role::text='owner')
      or app.crm_staff_permission_allowed(
        p_tenant,p_branch,'main.crm_optical_orders',true)
    )
    and not exists(select 1 from public.tenant_pos_menu_policies p
      where p.tenant_id=p_tenant and p.menu_key in (
        'main.crm_optical','main.crm_optical_orders',
        'settings.crm_optical_api_work_orders')
        and p.is_enabled=false)
    and exists(select 1 from public.tenant_subscription_contracts c
      join public.subscription_packages pkg on pkg.id=c.package_id
      where c.tenant_id=p_tenant and c.status in ('active','trial')
        and (c.ended_at is null or c.ended_at>now())
        and lower(pkg.code)='custom'
        and c.metadata->'sales_modes'->>'optical_retail'='true'
        and c.metadata->'custom_features'->>'optical_work_orders'='true'
        and c.metadata->>'pos_currency_code'='LAK');
$fn$;
revoke all on function app.optical_crm_draft_write_allowed(uuid,uuid) from public,anon;
grant execute on function app.optical_crm_draft_write_allowed(uuid,uuid) to authenticated;

-- Upsert draft with optimistic locking and request replay protection.
create or replace function public.customer_portal_save_optical_draft_v1(
  p_tenant_id uuid,p_branch_id uuid,p_draft_id uuid,
  p_customer_id uuid,p_eye_exam_id uuid,p_seller_id uuid,
  p_items jsonb,p_discount_lak numeric,p_due_at timestamptz,
  p_note text,p_expected_version integer,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app' as $fn$
declare
  v public.optical_work_order_drafts%rowtype;
  v_item jsonb;
  v_hash text;
  v_next_version integer;
  v_customer_exists boolean;
begin
  if auth.uid() is null or p_tenant_id is null or p_branch_id is null
     or p_draft_id is null or p_request_id is null
     or p_expected_version is null or p_expected_version<0
     or not app.optical_crm_draft_write_allowed(p_tenant_id,p_branch_id)
  then raise exception 'optical_draft_write_denied' using errcode='42501'; end if;
  if p_customer_id is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>30
     or p_discount_lak is null or p_discount_lak<>trunc(p_discount_lak)
     or p_discount_lak<0 or length(coalesce(p_note,''))>1000
  then raise exception 'optical_draft_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x
    group by x->>'product_id' having count(*)>1)
  then raise exception 'optical_duplicate_draft_item' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'product_id','') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(v_item->>'quantity','') !~ '^[1-9][0-9]{0,4}$'
    then raise exception 'optical_draft_item_invalid' using errcode='22023'; end if;
    if not exists(select 1 from public.optical_stock_bins b
      where b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
        and b.product_id=(v_item->>'product_id')::uuid and b.currency_code='LAK')
    then raise exception 'optical_draft_stock_scope_invalid' using errcode='22023'; end if;
  end loop;
  select exists(select 1 from public.optical_customers c
    where c.id=p_customer_id and c.tenant_id=p_tenant_id
      and c.branch_id=p_branch_id and c.deleted_at is null) into v_customer_exists;
  if not v_customer_exists then
    raise exception 'optical_draft_customer_not_found' using errcode='22023'; end if;
  if p_eye_exam_id is not null and not exists(
    select 1 from public.optical_eye_exams e where e.id=p_eye_exam_id
      and e.customer_id=p_customer_id and e.tenant_id=p_tenant_id
      and e.branch_id=p_branch_id
  ) then raise exception 'optical_draft_exam_invalid' using errcode='22023'; end if;
  if p_seller_id is not null and not exists(
    select 1 from public.user_branch_roles r
      join public.users_profiles u on u.id=r.user_id
      where u.id=p_seller_id and u.is_active and u.archived_at is null
        and r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
  ) then raise exception 'optical_draft_seller_invalid' using errcode='22023'; end if;
  v_hash:=md5(jsonb_build_object('customer',p_customer_id,'exam',p_eye_exam_id,
    'seller',p_seller_id,'items',p_items,'discount',p_discount_lak,
    'due',p_due_at,'note',coalesce(p_note,''))::text);
  select * into v from public.optical_work_order_drafts d
    where d.id=p_draft_id and d.tenant_id=p_tenant_id
      and d.branch_id=p_branch_id for update;
  if found then
    if v.last_request_id=p_request_id then
      if v.last_payload_hash<>v_hash then
        raise exception 'optical_draft_idempotency_conflict' using errcode='23505'; end if;
      return jsonb_build_object('id',v.id,'version',v.version,'duplicate_request',true);
    end if;
    if v.status<>'draft' or v.version<>p_expected_version then
      raise exception 'optical_draft_version_conflict' using errcode='40001'; end if;
    v_next_version:=v.version+1;
    update public.optical_work_order_drafts d set customer_id=p_customer_id,
      eye_exam_id=p_eye_exam_id,seller_id=p_seller_id,items=p_items,
      discount_lak=p_discount_lak,due_at=p_due_at,note=coalesce(p_note,''),
      version=v_next_version,last_request_id=p_request_id,last_payload_hash=v_hash,
      updated_at=now(),updated_by=auth.uid() where d.id=p_draft_id;
    insert into public.optical_work_order_draft_events(
      tenant_id,branch_id,draft_id,version,action,actor_id,previous_payload,next_payload)
    values(p_tenant_id,p_branch_id,p_draft_id,v_next_version,'updated',auth.uid(),
      to_jsonb(v),jsonb_build_object('customer',p_customer_id,'exam',p_eye_exam_id,
      'seller',p_seller_id,'items',p_items));
  else
    if p_expected_version<>0 then
      raise exception 'optical_draft_version_conflict' using errcode='40001'; end if;
    insert into public.optical_work_order_drafts(
      id,tenant_id,branch_id,customer_id,eye_exam_id,seller_id,items,
      discount_lak,due_at,note,last_request_id,last_payload_hash,created_by,updated_by
    ) values(p_draft_id,p_tenant_id,p_branch_id,p_customer_id,p_eye_exam_id,
      p_seller_id,p_items,p_discount_lak,p_due_at,coalesce(p_note,''),
      p_request_id,v_hash,auth.uid(),auth.uid());
    v_next_version:=1;
    insert into public.optical_work_order_draft_events(
      tenant_id,branch_id,draft_id,version,action,actor_id,next_payload)
    values(p_tenant_id,p_branch_id,p_draft_id,1,'created',auth.uid(),
      jsonb_build_object('customer',p_customer_id,'exam',p_eye_exam_id,
      'seller',p_seller_id,'items',p_items));
  end if;
  return jsonb_build_object('id',p_draft_id,'version',v_next_version,'duplicate_request',false);
end;
$fn$;
revoke all on function public.customer_portal_save_optical_draft_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,timestamptz,text,integer,uuid
) from public,anon;
grant execute on function public.customer_portal_save_optical_draft_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,timestamptz,text,integer,uuid
) to authenticated;

create or replace function public.customer_portal_transition_optical_draft_v1(
  p_tenant_id uuid,p_branch_id uuid,p_draft_id uuid,
  p_expected_version integer,p_request_id uuid,p_action text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app' as $fn$
declare
  v public.optical_work_order_drafts%rowtype;
  v_work_order_id uuid;
  v_duplicate boolean;
begin
  if auth.uid() is null or p_draft_id is null or p_request_id is null
    or p_expected_version is null
    or p_action not in ('void','issue')
    or not app.optical_crm_draft_write_allowed(p_tenant_id,p_branch_id)
  then raise exception 'optical_draft_transition_denied' using errcode='42501'; end if;
  select * into v from public.optical_work_order_drafts d
    where d.id=p_draft_id and d.tenant_id=p_tenant_id
      and d.branch_id=p_branch_id for update;
  if not found then raise exception 'optical_draft_not_found' using errcode='22023'; end if;
  if v.last_request_id=p_request_id then
    if (p_action='void' and v.status='void') or (p_action='issue' and v.status='issued') then
      return jsonb_build_object('id',v.id,'status',v.status,'work_order_id',v.issued_order_id,
        'duplicate_request',true);
    end if;
    raise exception 'optical_draft_idempotency_conflict' using errcode='23505';
  end if;
  if v.status<>'draft' or v.version<>p_expected_version then
    raise exception 'optical_draft_version_conflict' using errcode='40001'; end if;
  if p_action='issue' then
    -- Shared atomic reservation transaction validates current prices and stock.
    -- It is service-role EXECUTE only; called inside this restricted definer.
    select result.work_order_id,result.duplicate_request
      into v_work_order_id,v_duplicate
      from public.optical_create_work_order_tx(
        p_tenant_id,p_branch_id,auth.uid(),coalesce(v.seller_id,auth.uid()),
        v.customer_id,v.eye_exam_id,v.items,v.discount_lak,
        p_request_id,v.due_at,v.note
      ) result;
    if v_work_order_id is null then raise exception 'optical_draft_issue_failed'; end if;
  end if;
  update public.optical_work_order_drafts d
    set status=case when p_action='issue' then 'issued' else 'void' end,
      issued_order_id=case when p_action='issue' then v_work_order_id else null end,
      version=v.version+1,updated_at=now(),updated_by=auth.uid(),
      last_request_id=p_request_id
    where d.id=p_draft_id;
  insert into public.optical_work_order_draft_events(
    tenant_id,branch_id,draft_id,version,action,actor_id,previous_payload,next_payload)
  values(p_tenant_id,p_branch_id,p_draft_id,v.version+1,
    case when p_action='issue' then 'issued' else 'voided' end,auth.uid(),
    to_jsonb(v),jsonb_build_object('work_order_id',v_work_order_id));
  return jsonb_build_object('id',p_draft_id,'status',
    case when p_action='issue' then 'issued' else 'void' end,
    'work_order_id',v_work_order_id,'duplicate_request',false);
end;
$fn$;
revoke all on function public.customer_portal_transition_optical_draft_v1(
  uuid,uuid,uuid,integer,uuid,text
) from public,anon;
grant execute on function public.customer_portal_transition_optical_draft_v1(
  uuid,uuid,uuid,integer,uuid,text
) to authenticated;
commit;

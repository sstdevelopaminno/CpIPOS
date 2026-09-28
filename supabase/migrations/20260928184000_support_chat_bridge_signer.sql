-- Support Chat cross-project bridge signer.
-- The private.support_chat_bridge_config secret row is provisioned operationally
-- and must never be committed to source control.

create schema if not exists private;

create table if not exists private.support_chat_bridge_config (
  id text primary key,
  secret text not null,
  updated_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.issue_support_chat_bridge_token(
  p_user_id uuid,
  p_actor_type text,
  p_tenant_id uuid default null,
  p_branch_id uuid default null,
  p_role text default null,
  p_display_name text default null,
  p_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_secret text;
  v_payload jsonb;
  v_signature text;
begin
  if p_actor_type not in ('store','it') then
    raise exception 'invalid actor type';
  end if;
  select secret into v_secret from private.support_chat_bridge_config where id='v1';
  if v_secret is null then raise exception 'support chat bridge not configured'; end if;

  v_payload := jsonb_build_object(
    'v',1,'uid',p_user_id,'actor',p_actor_type,'tenant_id',p_tenant_id,'branch_id',p_branch_id,
    'role',p_role,'name',coalesce(p_display_name,''),'avatar_url',p_avatar_url,
    'iat',floor(extract(epoch from now()))::bigint,
    'exp',floor(extract(epoch from now()+interval '5 minutes'))::bigint,
    'nonce',gen_random_uuid()
  );
  v_signature := encode(hmac(convert_to(v_payload::text,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  return jsonb_build_object('payload',v_payload,'signature',v_signature);
end;
$$;

revoke all on function public.issue_support_chat_bridge_token(uuid,text,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.issue_support_chat_bridge_token(uuid,text,uuid,uuid,text,text,text)
  to service_role;

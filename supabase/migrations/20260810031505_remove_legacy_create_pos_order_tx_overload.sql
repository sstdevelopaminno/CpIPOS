-- Remove the obsolete 16-argument POS order RPC overloads. They make
-- PostgREST named-argument RPC resolution ambiguous now that the canonical
-- delivery-aware overload has optional parameters before p_items.

do $$
begin
  if to_regprocedure('public.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text)') is null then
    raise exception 'Canonical public.create_pos_order_tx overload is missing';
  end if;

  if to_regprocedure('app.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text)') is null then
    raise exception 'Canonical app.create_pos_order_tx overload is missing';
  end if;
end
$$;

drop function if exists public.create_pos_order_tx(
  uuid,
  uuid,
  uuid,
  uuid,
  public.order_type,
  text,
  uuid,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  jsonb,
  text,
  text
);

drop function if exists app.create_pos_order_tx(
  uuid,
  uuid,
  uuid,
  uuid,
  public.order_type,
  text,
  uuid,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  jsonb,
  text,
  text
);

notify pgrst, 'reload schema';

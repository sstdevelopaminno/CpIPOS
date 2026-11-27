-- Read-only calculations for an eventual atomic correction. No legal tax
-- document is issued, no GL or stock mutation is performed.
begin;
create function public.recycling_preview_issued_vat_adjustment(
 p_tenant uuid,p_branch uuid,p_invoice uuid,p_actor uuid,p_new_base bigint
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare inv public.recycling_tax_invoices%rowtype; base bigint; tax bigint; rate numeric; new_tax bigint; delta bigint;
begin
 if p_new_base is null or p_new_base<0 or p_new_base>99999999999999 then raise exception 'recycling_vat_adjustment_invalid'; end if;
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id join public.tenants t on t.id=r.tenant_id where r.tenant_id=p_tenant and r.branch_id=p_branch and r.user_id=p_actor and r.role::text in ('owner','manager','accountant') and u.is_active and b.is_active and t.is_active) then raise exception 'recycling_vat_adjustment_forbidden'; end if;
 select * into inv from public.recycling_tax_invoices where id=p_invoice and tenant_id=p_tenant and branch_id=p_branch and status='issued';
 if not found then raise exception 'recycling_vat_adjustment_invoice_missing'; end if;
 base:=(inv.tax_snapshot->>'base_minor')::bigint; tax:=(inv.tax_snapshot->>'vat_minor')::bigint; rate:=(inv.tax_snapshot->>'rate_pct')::numeric;
 if base is null or base<=0 or tax is null or rate is distinct from 7 or inv.tax_snapshot->>'mode' is distinct from 'add_to_bill' or tax<>round(base::numeric*rate/100) or (inv.tax_snapshot->>'total_minor')::bigint is distinct from base+tax then raise exception 'recycling_vat_adjustment_original_invalid'; end if;
 new_tax:=round(p_new_base::numeric*rate/100)::bigint;
 delta:=p_new_base-base;
 return jsonb_build_object('draft_only',true,'invoice_id',inv.id,'invoice_no',inv.invoice_no,'type',case when delta<0 then 'credit_note' when delta>0 then 'debit_note' else 'none' end,
 'original_base_minor',base,'original_vat_minor',tax,'new_base_minor',p_new_base,'new_vat_minor',new_tax,
 'base_delta_minor',delta,'vat_delta_minor',new_tax-tax,'gross_delta_minor',delta+new_tax-tax,'rate_pct',rate,
 'seller_snapshot',inv.seller_snapshot,'buyer_snapshot',inv.buyer_snapshot);
end;
$fn$;
revoke all on function public.recycling_preview_issued_vat_adjustment(uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
create function public.recycling_preview_stock_replay(
 p_tenant uuid,p_branch uuid,p_actor uuid,p_product uuid,p_target_line uuid,p_new_qty numeric,p_new_amount bigint
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare bal public.recycling_stock_balances%rowtype; target public.recycling_transaction_lines%rowtype;
 cur uuid; chain uuid[]:='{}'; tx uuid; l record; first_line record;
 oq numeric; nq numeric; ov bigint; nv bigint; old_c bigint; new_c bigint; q numeric; amount bigint;
 effects jsonb:='[]'; found_target boolean:=false; n int:=0; i int;
begin
 if p_new_qty is null or p_new_qty<=0 or p_new_qty>100000000 or p_new_qty<>round(p_new_qty,6)
 or p_new_amount is null or p_new_amount<=0 or p_new_amount>99999999999999 then raise exception 'recycling_replay_invalid'; end if;
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id join public.tenants t on t.id=r.tenant_id where r.tenant_id=p_tenant and r.branch_id=p_branch and r.user_id=p_actor and r.role::text in ('owner','manager','accountant') and u.is_active and b.is_active and t.is_active) then raise exception 'recycling_replay_forbidden'; end if;
 select * into target from public.recycling_transaction_lines where id=p_target_line and tenant_id=p_tenant and branch_id=p_branch and product_id=p_product;
 if not found then raise exception 'recycling_replay_target_missing'; end if;
 if target.base_unit='piece' and p_new_qty<>trunc(p_new_qty) then raise exception 'recycling_replay_invalid'; end if;
 select * into bal from public.recycling_stock_balances where tenant_id=p_tenant and branch_id=p_branch and product_id=p_product;
 if not found then raise exception 'recycling_replay_stock_missing'; end if;
 cur:=bal.last_transaction_id;
 while cur is not null loop
  n:=n+1;
  if n>500 or cur=any(chain) then raise exception 'recycling_replay_chain_invalid'; end if;
  chain:=array_append(chain,cur);
  select ll.stock_last_transaction_before,ll.stock_qty_before,ll.stock_cost_before_minor into first_line from public.recycling_transaction_lines ll join public.recycling_transactions tt on tt.id=ll.transaction_id and tt.tenant_id=ll.tenant_id and tt.branch_id=ll.branch_id
   where ll.tenant_id=p_tenant and ll.branch_id=p_branch and ll.product_id=p_product and ll.transaction_id=cur and tt.status='posted' order by ll.line_no limit 1;
  if not found then raise exception 'recycling_replay_chain_invalid'; end if;
  if cur=target.transaction_id then found_target:=true;exit; end if;
  cur:=first_line.stock_last_transaction_before;
 end loop;
 if not found_target then raise exception 'recycling_replay_target_not_in_chain'; end if;
 oq:=first_line.stock_qty_before; nq:=oq; ov:=first_line.stock_cost_before_minor; nv:=ov;
 for i in reverse array_length(chain,1)..1 loop
  tx:=chain[i];
  for l in select ll.*,tt.direction from public.recycling_transaction_lines ll join public.recycling_transactions tt on tt.id=ll.transaction_id and tt.tenant_id=ll.tenant_id and tt.branch_id=ll.branch_id
   where ll.tenant_id=p_tenant and ll.branch_id=p_branch and ll.product_id=p_product and ll.transaction_id=tx and tt.status='posted' order by ll.line_no loop
   if oq is distinct from l.stock_qty_before or ov is distinct from l.stock_cost_before_minor then raise exception 'recycling_replay_snapshot_drift'; end if;
   q:=case when l.id=p_target_line then p_new_qty else l.base_quantity end;
   amount:=case when l.id=p_target_line then p_new_amount else l.amount_minor end;
   if l.direction='buy' then
    oq:=oq+l.base_quantity; ov:=ov+l.amount_minor; nq:=nq+q; nv:=nv+amount;
   else
    if oq<l.base_quantity or nq<q then raise exception 'recycling_replay_negative_stock'; end if;
    old_c:=case when oq=l.base_quantity then ov else round(ov*l.base_quantity/oq)::bigint end;
    new_c:=case when nq=q then nv else round(nv*q/nq)::bigint end;
    if old_c is distinct from l.cogs_minor then raise exception 'recycling_replay_snapshot_drift'; end if;
    oq:=oq-l.base_quantity;ov:=ov-old_c;nq:=nq-q;nv:=nv-new_c;
    effects:=effects||jsonb_build_array(jsonb_build_object('transaction_id',tx,'line_id',l.id,'old_cogs_minor',old_c,'new_cogs_minor',new_c,'cogs_delta_minor',new_c-old_c));
   end if;
  end loop;
 end loop;
 if oq is distinct from bal.quantity_base or ov is distinct from bal.carrying_cost_minor then raise exception 'recycling_replay_snapshot_drift'; end if;
 return jsonb_build_object('preview_only',true,'product_id',p_product,'target_line_id',p_target_line,'old_qty',oq,'new_qty',nq,'old_cost_minor',ov,'new_cost_minor',nv,'cost_delta_minor',nv-ov,'affected_sales',effects,'movement_count',n);
end;
$fn$;
revoke all on function public.recycling_preview_stock_replay(uuid,uuid,uuid,uuid,uuid,numeric,bigint) from public,anon,authenticated,service_role;
commit;

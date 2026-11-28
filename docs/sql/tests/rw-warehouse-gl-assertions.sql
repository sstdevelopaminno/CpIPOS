-- Test the real finance migration with synthetic warehouse events.
insert into public.finance_accounting_chart(id,tenant_id,account_code,account_name,account_type,created_by) values
('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001','TEST-WH','Synthetic warehouse','asset','00000000-0000-0000-0000-000000000032'),
('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000001','TEST-TR','Synthetic transit','asset','00000000-0000-0000-0000-000000000032'),
('00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000001','TEST-BR','Synthetic branch','asset','00000000-0000-0000-0000-000000000032');
insert into public.rw_finance_account_mapping values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000203');
set role service_role;
do $fn$ declare d uuid; receipt uuid; response jsonb; begin
 select id into strict d from public.rw_warehouse_ledger where tenant_id='00000000-0000-0000-0000-000000000001' and transfer_id='00000000-0000-0000-0000-000000000071' and event='dispatch';
 select id into strict receipt from public.rw_warehouse_ledger where tenant_id='00000000-0000-0000-0000-000000000001' and transfer_id='00000000-0000-0000-0000-000000000071' and event='branch_receipt' and branch_delta=2;
 begin perform public.rw_post_transfer_gl_candidate('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000032',receipt); raise exception 'EXPECTED_FAILURE'; exception when others then if sqlerrm<>'finance_accounting_warehouse_dispatch_gl_required' then raise; end if; end;
 response:=public.rw_post_transfer_gl_candidate('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000032',d);
 if response->>'posted'<>'true' then raise exception 'GL_DISPATCH'; end if;
 if public.rw_post_transfer_gl_candidate('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000032',d)->>'idempotent'<>'true' then raise exception 'GL_REPLAY'; end if;
 perform public.rw_post_transfer_gl_candidate('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000032',receipt);
 if (select count(*) from public.finance_accounting_journals where tenant_id='00000000-0000-0000-0000-000000000001')<>2 then raise exception 'GL_COUNT'; end if;
 if (select sum(debit_minor)-sum(credit_minor) from public.finance_accounting_journal_lines where tenant_id='00000000-0000-0000-0000-000000000001')<>0 then raise exception 'GL_UNBALANCED'; end if;
 if (select sum(debit_minor)-sum(credit_minor) from public.finance_accounting_journal_lines where account_id='00000000-0000-0000-0000-000000000202')<>100 then raise exception 'GL_TRANSIT_BALANCE'; end if;
 if has_function_privilege('authenticated','public.rw_post_transfer_gl_candidate(uuid,uuid,uuid,uuid)','EXECUTE') then raise exception 'GL_BROWSER_GRANTED'; end if;
end $fn$;
reset role;
select 'WAREHOUSE GL ASSERTIONS PASSED';

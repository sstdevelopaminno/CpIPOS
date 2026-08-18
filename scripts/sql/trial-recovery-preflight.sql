-- CpIPOS CpiPOS-002 recovery preflight.
-- IMPORTANT: this file is intentionally transaction-only and always ROLLBACKs.
-- It must be executed only against the protected Trial project.

begin;

do $preflight$
declare
  v_tenant_a constant uuid := '91000000-0000-4000-8000-000000000001';
  v_branch_a constant uuid := '91000000-0000-4000-8000-000000001001';
  v_user_a constant uuid := '91000000-0000-4000-8000-000000002001';
  v_shift_a constant uuid := '91000000-0000-4000-8000-000000003001';
  v_lease_a constant uuid := '91000000-0000-4000-8000-000000004001';
  v_product_a constant uuid := '91000000-0000-4000-8000-000000005001';
  v_table_a constant uuid := '91000000-0000-4000-8000-000000006001';
  v_bill_a constant uuid := '91000000-0000-4000-8000-000000007001';
  v_qr_a constant uuid := '91000000-0000-4000-8000-000000008001';
  v_printer_a constant uuid := '91000000-0000-4000-8000-000000009001';
  v_job_a constant uuid := '91000000-0000-4000-8000-000000010001';
  v_agent_1 constant uuid := '91000000-0000-4000-8000-000000011001';
  v_agent_2 constant uuid := '91000000-0000-4000-8000-000000011002';

  v_tenant_b constant uuid := '92000000-0000-4000-8000-000000000001';
  v_branch_b constant uuid := '92000000-0000-4000-8000-000000001001';
  v_user_b constant uuid := '92000000-0000-4000-8000-000000002001';
  v_shift_b constant uuid := '92000000-0000-4000-8000-000000003001';
  v_lease_b constant uuid := '92000000-0000-4000-8000-000000004001';
  v_product_b constant uuid := '92000000-0000-4000-8000-000000005001';
  v_table_b constant uuid := '92000000-0000-4000-8000-000000006001';
  v_bill_b constant uuid := '92000000-0000-4000-8000-000000007001';
  v_qr_b constant uuid := '92000000-0000-4000-8000-000000008001';

  v_pos_1 record;
  v_pos_2 record;
  v_pay_1 record;
  v_pay_2 record;
  v_qr_1 record;
  v_qr_2 record;
  v_claim_1 record;
  v_claim_2 record;
  v_qr_recovered record;
  v_count integer;
  v_total numeric;
  v_paid numeric;
  v_payment_sum numeric;
  v_job_status text;
  v_retry_count integer;
  v_attempt_1_status text;
  v_attempt_2_status text;
begin
  if exists (select 1 from public.trial_tenant_scopes where tenant_id in (v_tenant_a, v_tenant_b)) then
    raise exception 'PREFLIGHT_NAMESPACE_COLLISION';
  end if;

  insert into public.trial_tenant_scopes(
    tenant_id,lifecycle_status,is_active,source_control_plane,synced_at,metadata,
    trial_started_at,trial_expires_at,retention_until,access_locked,lock_reason
  ) values
    (v_tenant_a,'trial',true,'preflight',now(),jsonb_build_object('source','trial_recovery_preflight'),now(),now()+interval '1 day',now()+interval '8 days',false,null),
    (v_tenant_b,'trial',true,'preflight',now(),jsonb_build_object('source','trial_recovery_preflight'),now(),now()+interval '1 day',now()+interval '8 days',false,null);

  insert into public.trial_branch_scopes(tenant_id,branch_id,is_active,synced_at,metadata) values
    (v_tenant_a,v_branch_a,true,now(),jsonb_build_object('source','trial_recovery_preflight')),
    (v_tenant_b,v_branch_b,true,now(),jsonb_build_object('source','trial_recovery_preflight'));

  insert into public.trial_runtime_leases(
    pos_session_id,tenant_id,branch_id,shift_id,user_id,device_code,status,issued_at,expires_at,synced_at,metadata
  ) values
    (v_lease_a,v_tenant_a,v_branch_a,v_shift_a,v_user_a,'PREFLIGHT-A','active',now(),now()+interval '1 hour',now(),jsonb_build_object('source','trial_recovery_preflight')),
    (v_lease_b,v_tenant_b,v_branch_b,v_shift_b,v_user_b,'PREFLIGHT-B','active',now(),now()+interval '1 hour',now(),jsonb_build_object('source','trial_recovery_preflight'));

  insert into public.products(id,tenant_id,branch_id,sku,name,category,price,is_active,metadata) values
    (v_product_a,v_tenant_a,v_branch_a,'PREFLIGHT-A','Preflight A','Preflight',100,true,jsonb_build_object('source','trial_recovery_preflight')),
    (v_product_b,v_tenant_b,v_branch_b,'PREFLIGHT-B','Preflight B','Preflight',120,true,jsonb_build_object('source','trial_recovery_preflight'));

  insert into public.dining_tables(id,tenant_id,branch_id,table_code,table_name,status,is_active,metadata) values
    (v_table_a,v_tenant_a,v_branch_a,'PREFLIGHT-A1','Preflight A1','occupied',true,jsonb_build_object('source','trial_recovery_preflight')),
    (v_table_b,v_tenant_b,v_branch_b,'PREFLIGHT-B1','Preflight B1','occupied',true,jsonb_build_object('source','trial_recovery_preflight'));

  insert into public.table_bill_sessions(id,tenant_id,branch_id,table_id,opened_by,status,metadata) values
    (v_bill_a,v_tenant_a,v_branch_a,v_table_a,v_user_a,'open',jsonb_build_object('source','trial_recovery_preflight')),
    (v_bill_b,v_tenant_b,v_branch_b,v_table_b,v_user_b,'open',jsonb_build_object('source','trial_recovery_preflight'));

  insert into public.table_qr_sessions(id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by) values
    (v_qr_a,v_tenant_a,v_branch_a,v_table_a,v_bill_a,'active',now()+interval '1 hour',v_user_a),
    (v_qr_b,v_tenant_b,v_branch_b,v_table_b,v_bill_b,'active',now()+interval '1 hour',v_user_b);

  select * into v_pos_1
  from public.create_pos_order_tx(
    v_tenant_a,v_branch_a,v_shift_a,v_user_a,'takeaway'::public.order_type,'preflight',null,null,null,'recovery preflight',
    100,0,0,null,null,null,null,null,null,null,null,null,null,
    jsonb_build_array(jsonb_build_object('product_id',v_product_a,'quantity',1,'unit_price',100,'notes',null)),
    'PREFLIGHT-POS-REPLAY','TKO-PREFLIGHT-A-001'
  );

  select * into v_pos_2
  from public.create_pos_order_tx(
    v_tenant_a,v_branch_a,v_shift_a,v_user_a,'takeaway'::public.order_type,'preflight',null,null,null,'recovery preflight',
    100,0,0,null,null,null,null,null,null,null,null,null,null,
    jsonb_build_array(jsonb_build_object('product_id',v_product_a,'quantity',1,'unit_price',100,'notes',null)),
    'PREFLIGHT-POS-REPLAY','TKO-PREFLIGHT-A-001'
  );

  if v_pos_1.order_id is null or v_pos_1.order_id is distinct from v_pos_2.order_id
     or coalesce(v_pos_1.duplicate_request,true) or not coalesce(v_pos_2.duplicate_request,false) then
    raise exception 'PREFLIGHT_POS_REPLAY_FAILED';
  end if;

  select count(*) into v_count
  from public.orders
  where tenant_id=v_tenant_a and branch_id=v_branch_a and request_id='PREFLIGHT-POS-REPLAY';
  if v_count <> 1 then raise exception 'PREFLIGHT_POS_ORDER_COUNT:%',v_count; end if;

  select * into v_pay_1
  from public.complete_pos_payment_tx(
    v_tenant_a,v_branch_a,v_pos_1.order_id,v_user_a,
    jsonb_build_array(jsonb_build_object('method','cash','amount',100,'reference_no',null)),
    'PREFLIGHT-PAY-REPLAY'
  );

  select * into v_pay_2
  from public.complete_pos_payment_tx(
    v_tenant_a,v_branch_a,v_pos_1.order_id,v_user_a,
    jsonb_build_array(jsonb_build_object('method','cash','amount',100,'reference_no',null)),
    'PREFLIGHT-PAY-REPLAY'
  );

  if coalesce(v_pay_1.duplicate_request,true) or not coalesce(v_pay_2.duplicate_request,false) then
    raise exception 'PREFLIGHT_PAYMENT_REPLAY_FAILED';
  end if;

  select count(*),coalesce(sum(amount),0) into v_count,v_payment_sum
  from public.payments
  where tenant_id=v_tenant_a and branch_id=v_branch_a and order_id=v_pos_1.order_id and request_group_id='PREFLIGHT-PAY-REPLAY';
  select total_amount,paid_total into v_total,v_paid from public.orders where id=v_pos_1.order_id;
  if v_count <> 1 or v_payment_sum <> v_total or v_paid <> v_total then
    raise exception 'PREFLIGHT_PAYMENT_INTEGRITY_FAILED rows=% sum=% total=% paid=%',v_count,v_payment_sum,v_total,v_paid;
  end if;

  select * into v_qr_1
  from public.submit_table_qr_order_tx(
    v_qr_b,'PREFLIGHT-QR-REPLAY',
    jsonb_build_array(jsonb_build_object('product_id',v_product_b,'quantity',1,'note',null)),
    'recovery preflight'
  );

  select * into v_qr_2
  from public.submit_table_qr_order_tx(
    v_qr_b,'PREFLIGHT-QR-REPLAY',
    jsonb_build_array(jsonb_build_object('product_id',v_product_b,'quantity',1,'note',null)),
    'recovery preflight'
  );

  if v_qr_1.submission_id is null or v_qr_1.submission_id is distinct from v_qr_2.submission_id
     or v_qr_1.order_id is distinct from v_qr_2.order_id
     or coalesce(v_qr_1.duplicate_request,true) or not coalesce(v_qr_2.duplicate_request,false) then
    raise exception 'PREFLIGHT_QR_REPLAY_FAILED';
  end if;

  select count(*) into v_count from public.table_qr_orders
  where tenant_id=v_tenant_b and branch_id=v_branch_b and request_id='PREFLIGHT-QR-REPLAY';
  if v_count <> 1 then raise exception 'PREFLIGHT_QR_ROW_COUNT:%',v_count; end if;

  insert into public.printer_profiles(
    id,tenant_id,branch_id,printer_name,printer_role,connection_type,paper_width_mm,enabled,metadata
  ) values (
    v_printer_a,v_tenant_a,v_branch_a,'Preflight Printer','receipt','LOCAL_BRIDGE',58,true,jsonb_build_object('source','trial_recovery_preflight')
  );

  insert into public.print_jobs(
    id,tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,
    retry_count,max_retry_count,idempotency_key,metadata
  ) values (
    v_job_a,v_tenant_a,v_branch_a,v_pos_1.order_id,v_printer_a,'receipt','LOCAL_BRIDGE','pending','PREFLIGHT','{}'::jsonb,
    0,3,'PREFLIGHT-PRINT-LEASE',jsonb_build_object('source','trial_recovery_preflight')
  );

  select * into v_claim_1 from public.claim_print_jobs_v2(v_tenant_a,v_branch_a,v_agent_1,array[v_printer_a],1,15);
  if v_claim_1.job_id is distinct from v_job_a or v_claim_1.attempt_no <> 1 then
    raise exception 'PREFLIGHT_PRINT_FIRST_CLAIM_FAILED';
  end if;

  update public.print_jobs set claim_expires_at=now()-interval '1 second' where id=v_job_a;
  select * into v_claim_2 from public.claim_print_jobs_v2(v_tenant_a,v_branch_a,v_agent_2,array[v_printer_a],1,300);
  if v_claim_2.job_id is distinct from v_job_a or v_claim_2.attempt_no <> 2 then
    raise exception 'PREFLIGHT_PRINT_RECLAIM_FAILED';
  end if;

  select status into v_attempt_1_status from public.print_job_attempts where print_job_id=v_job_a and attempt_no=1;
  select status into v_attempt_2_status from public.print_job_attempts where print_job_id=v_job_a and attempt_no=2;
  select status,retry_count into v_job_status,v_retry_count from public.print_jobs where id=v_job_a;
  if v_attempt_1_status <> 'expired' or v_attempt_2_status <> 'claimed' or v_job_status <> 'printing' or v_retry_count <> 1 then
    raise exception 'PREFLIGHT_PRINT_EXPIRE_STATE_FAILED a1=% a2=% job=% retry=%',v_attempt_1_status,v_attempt_2_status,v_job_status,v_retry_count;
  end if;

  perform 1 from public.ack_print_job_v2(
    v_tenant_a,v_branch_a,v_job_a,v_agent_2,v_claim_2.agent_attempt_id,'preflight-provider',128,
    jsonb_build_object('source','trial_recovery_preflight')
  );
  select status into v_job_status from public.print_jobs where id=v_job_a;
  select status into v_attempt_2_status from public.print_job_attempts where print_job_id=v_job_a and attempt_no=2;
  if v_job_status <> 'printed' or v_attempt_2_status <> 'printed' then
    raise exception 'PREFLIGHT_PRINT_ACK_FAILED job=% attempt=%',v_job_status,v_attempt_2_status;
  end if;

  update public.trial_runtime_leases set status='revoked',synced_at=now() where pos_session_id=v_lease_a;
  begin
    perform 1 from public.submit_table_qr_order_tx(
      v_qr_a,'PREFLIGHT-ROUTE-RECOVERY',
      jsonb_build_array(jsonb_build_object('product_id',v_product_a,'quantity',1,'note',null)),
      'must fail closed'
    );
    raise exception 'PREFLIGHT_ROUTE_EXPECTED_SHIFT_NOT_OPEN';
  exception when others then
    if sqlerrm not like '%SHIFT_NOT_OPEN%' then raise; end if;
  end;

  select count(*) into v_count from public.table_qr_orders
  where tenant_id=v_tenant_a and branch_id=v_branch_a and request_id='PREFLIGHT-ROUTE-RECOVERY';
  if v_count <> 0 then raise exception 'PREFLIGHT_ROUTE_FAIL_CLOSED_WROTE_DATA:%',v_count; end if;

  update public.trial_runtime_leases set status='active',expires_at=now()+interval '1 hour',synced_at=now() where pos_session_id=v_lease_a;
  select * into v_qr_recovered
  from public.submit_table_qr_order_tx(
    v_qr_a,'PREFLIGHT-ROUTE-RECOVERY',
    jsonb_build_array(jsonb_build_object('product_id',v_product_a,'quantity',1,'note',null)),
    'recovered'
  );
  if v_qr_recovered.order_id is null or coalesce(v_qr_recovered.duplicate_request,true) then
    raise exception 'PREFLIGHT_ROUTE_RECOVERY_FAILED';
  end if;

  select count(*) into v_count
  from public.table_qr_orders q
  join public.table_qr_sessions s on s.id=q.qr_session_id
  where q.tenant_id in (v_tenant_a,v_tenant_b)
    and (q.tenant_id<>s.tenant_id or q.branch_id<>s.branch_id or q.table_id<>s.table_id or q.table_session_id<>s.table_session_id);
  if v_count <> 0 then raise exception 'PREFLIGHT_CROSS_SCOPE_QR:%',v_count; end if;

  raise notice 'TRIAL_RECOVERY_PREFLIGHT_PASS';
end
$preflight$;

rollback;

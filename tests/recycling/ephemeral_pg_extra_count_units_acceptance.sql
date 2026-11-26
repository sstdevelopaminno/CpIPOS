-- Synthetic only; all writes rollback.
begin;
insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('c1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-VEHICLE','Synthetic vehicle','UAT',100.25,'piece','{"business_mode":"recycling","recycling_price_basis":"piece","recycling_price_unit":"vehicle","recycling_buy_price":75.50}');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
values('c1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1000,'open','{"business_shift_mode":"recycling_daily"}');
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 s uuid:='c1000000-0000-4000-8000-000000000002';
 p uuid:='c1000000-0000-4000-8000-000000000001';
 buy jsonb; sale jsonb;
begin
 buy:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000003','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','vehicle','quantity',3,'expected_price',75.50)));
 if (buy->>'total_minor')::bigint<>22650 then raise exception 'VEHICLE_BUY_TOTAL'; end if;
 if not exists(select 1 from public.recycling_transaction_lines where transaction_id=(buy->>'id')::uuid and original_unit='vehicle' and original_quantity=3 and base_quantity=3) then raise exception 'VEHICLE_SNAPSHOT'; end if;
 sale:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000004','sell','cash','Synthetic buyer',jsonb_build_array(jsonb_build_object('product_id',p,'unit','vehicle','quantity',2,'expected_price',100.25)));
 if (sale->>'total_minor')::bigint<>20050 then raise exception 'VEHICLE_SELL_TOTAL'; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=1 and carrying_cost_minor=7550) then raise exception 'VEHICLE_STOCK'; end if;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000005','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','vehicle','quantity',1.5,'expected_price',75.50)));
  raise exception 'VEHICLE_FRACTION_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_piece_must_be_whole%' then raise; end if; end;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000006','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',1,'expected_price',75.50)));
  raise exception 'VEHICLE_WRONG_UNIT_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_unit_mismatch%' then raise; end if; end;
 raise notice 'PASS: whole-vehicle stock, exact prices, snapshots and rejection';
end;
$uat$;
rollback;

-- Synthetic only; all writes rollback.
begin;
insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('c1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-SET','Synthetic set','UAT',100.25,'piece','{"business_mode":"recycling","recycling_price_basis":"piece","recycling_price_unit":"set","recycling_buy_price":75.50}');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
values('c1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1000,'open','{"business_shift_mode":"recycling_daily"}');
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 s uuid:='c1000000-0000-4000-8000-000000000002';
 p uuid:='c1000000-0000-4000-8000-000000000001';
 buy jsonb; sale jsonb;
begin
 buy:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000003','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','set','quantity',3,'expected_price',75.50)));
 if (buy->>'total_minor')::bigint<>22650 then raise exception 'SET_BUY_TOTAL'; end if;
 if not exists(select 1 from public.recycling_transaction_lines where transaction_id=(buy->>'id')::uuid and original_unit='set' and original_quantity=3 and base_quantity=3) then raise exception 'SET_SNAPSHOT'; end if;
 sale:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000004','sell','cash','Synthetic buyer',jsonb_build_array(jsonb_build_object('product_id',p,'unit','set','quantity',2,'expected_price',100.25)));
 if (sale->>'total_minor')::bigint<>20050 then raise exception 'SET_SELL_TOTAL'; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=1 and carrying_cost_minor=7550) then raise exception 'SET_STOCK'; end if;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000005','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','set','quantity',1.5,'expected_price',75.50)));
  raise exception 'SET_FRACTION_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_piece_must_be_whole%' then raise; end if; end;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000006','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',1,'expected_price',75.50)));
  raise exception 'SET_WRONG_UNIT_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_unit_mismatch%' then raise; end if; end;
 raise notice 'PASS: whole-set stock, exact prices, snapshots and rejection';
end;
$uat$;
rollback;

-- Synthetic only; all writes rollback.
begin;
insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('c1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-UNIT','Synthetic unit','UAT',100.25,'piece','{"business_mode":"recycling","recycling_price_basis":"piece","recycling_price_unit":"unit","recycling_buy_price":75.50}');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
values('c1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1000,'open','{"business_shift_mode":"recycling_daily"}');
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 s uuid:='c1000000-0000-4000-8000-000000000002';
 p uuid:='c1000000-0000-4000-8000-000000000001';
 buy jsonb; sale jsonb;
begin
 buy:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000003','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','unit','quantity',3,'expected_price',75.50)));
 if (buy->>'total_minor')::bigint<>22650 then raise exception 'UNIT_BUY_TOTAL'; end if;
 if not exists(select 1 from public.recycling_transaction_lines where transaction_id=(buy->>'id')::uuid and original_unit='unit' and original_quantity=3 and base_quantity=3) then raise exception 'UNIT_SNAPSHOT'; end if;
 sale:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000004','sell','cash','Synthetic buyer',jsonb_build_array(jsonb_build_object('product_id',p,'unit','unit','quantity',2,'expected_price',100.25)));
 if (sale->>'total_minor')::bigint<>20050 then raise exception 'UNIT_SELL_TOTAL'; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=1 and carrying_cost_minor=7550) then raise exception 'UNIT_STOCK'; end if;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000005','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','unit','quantity',1.5,'expected_price',75.50)));
  raise exception 'UNIT_FRACTION_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_piece_must_be_whole%' then raise; end if; end;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000006','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',1,'expected_price',75.50)));
  raise exception 'UNIT_WRONG_UNIT_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_unit_mismatch%' then raise; end if; end;
 raise notice 'PASS: whole-unit stock, exact prices, snapshots and rejection';
end;
$uat$;
rollback;

-- Synthetic only; all writes rollback.
begin;
insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('c1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-MACHINE','Synthetic machine','UAT',100.25,'piece','{"business_mode":"recycling","recycling_price_basis":"piece","recycling_price_unit":"machine","recycling_buy_price":75.50}');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
values('c1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1000,'open','{"business_shift_mode":"recycling_daily"}');
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 s uuid:='c1000000-0000-4000-8000-000000000002';
 p uuid:='c1000000-0000-4000-8000-000000000001';
 buy jsonb; sale jsonb;
begin
 buy:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000003','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','machine','quantity',3,'expected_price',75.50)));
 if (buy->>'total_minor')::bigint<>22650 then raise exception 'MACHINE_BUY_TOTAL'; end if;
 if not exists(select 1 from public.recycling_transaction_lines where transaction_id=(buy->>'id')::uuid and original_unit='machine' and original_quantity=3 and base_quantity=3) then raise exception 'MACHINE_SNAPSHOT'; end if;
 sale:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000004','sell','cash','Synthetic buyer',jsonb_build_array(jsonb_build_object('product_id',p,'unit','machine','quantity',2,'expected_price',100.25)));
 if (sale->>'total_minor')::bigint<>20050 then raise exception 'MACHINE_SELL_TOTAL'; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=1 and carrying_cost_minor=7550) then raise exception 'MACHINE_STOCK'; end if;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000005','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','machine','quantity',1.5,'expected_price',75.50)));
  raise exception 'MACHINE_FRACTION_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_piece_must_be_whole%' then raise; end if; end;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000006','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',1,'expected_price',75.50)));
  raise exception 'MACHINE_WRONG_UNIT_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_unit_mismatch%' then raise; end if; end;
 raise notice 'PASS: whole-machine stock, exact prices, snapshots and rejection';
end;
$uat$;
rollback;

-- Synthetic only; all writes rollback.
begin;
insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('c1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-CABINET','Synthetic cabinet','UAT',100.25,'piece','{"business_mode":"recycling","recycling_price_basis":"piece","recycling_price_unit":"cabinet","recycling_buy_price":75.50}');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
values('c1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1000,'open','{"business_shift_mode":"recycling_daily"}');
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 s uuid:='c1000000-0000-4000-8000-000000000002';
 p uuid:='c1000000-0000-4000-8000-000000000001';
 buy jsonb; sale jsonb;
begin
 buy:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000003','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','cabinet','quantity',3,'expected_price',75.50)));
 if (buy->>'total_minor')::bigint<>22650 then raise exception 'CABINET_BUY_TOTAL'; end if;
 if not exists(select 1 from public.recycling_transaction_lines where transaction_id=(buy->>'id')::uuid and original_unit='cabinet' and original_quantity=3 and base_quantity=3) then raise exception 'CABINET_SNAPSHOT'; end if;
 sale:=public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000004','sell','cash','Synthetic buyer',jsonb_build_array(jsonb_build_object('product_id',p,'unit','cabinet','quantity',2,'expected_price',100.25)));
 if (sale->>'total_minor')::bigint<>20050 then raise exception 'CABINET_SELL_TOTAL'; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=1 and carrying_cost_minor=7550) then raise exception 'CABINET_STOCK'; end if;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000005','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','cabinet','quantity',1.5,'expected_price',75.50)));
  raise exception 'CABINET_FRACTION_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_piece_must_be_whole%' then raise; end if; end;
 begin
  perform public.recycling_post_transaction_vat(t,b,s,u,'c1000000-0000-4000-8000-000000000006','buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',1,'expected_price',75.50)));
  raise exception 'CABINET_WRONG_UNIT_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_unit_mismatch%' then raise; end if; end;
 raise notice 'PASS: whole-cabinet stock, exact prices, snapshots and rejection';
end;
$uat$;
rollback;

drop trigger if exists trg_order_items_trusted_unit_price on public.order_items;
drop function if exists app.enforce_trusted_pos_unit_price();

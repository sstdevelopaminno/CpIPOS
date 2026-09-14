alter table public.product_combo_items
  add constraint product_combo_items_qty_integer_min_one
  check (qty >= 1 and qty = trunc(qty));

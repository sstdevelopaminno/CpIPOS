alter table public.products
  add column if not exists customer_ingredient_selection_enabled boolean not null default false;

comment on column public.products.customer_ingredient_selection_enabled is
  'When true, Table QR customers may select recipe ingredients as order preferences. This flag does not change catalog price or recipe quantities.';

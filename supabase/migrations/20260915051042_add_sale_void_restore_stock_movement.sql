-- Dedicated stock movement type for automatic POS bill cancellation reversal.
-- This keeps automated sale reversals distinct from operator manual_adjustment,
-- which intentionally requires manager approval.

ALTER TYPE public.stock_movement_type
  ADD VALUE IF NOT EXISTS 'sale_void_restore';

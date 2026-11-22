-- CUSTOM Recycling ONLY: reconcile RCY-0001 serial format with
-- previously installed receipt check constraint after 20261122054149.
--
-- Production incident 2026-11-22 07:15 UTC: PostgreSQL SQLSTATE 23514
-- from recycling_transactions_receipt_no_check, which had minimum length 12.
-- New RCY-0001 has length 8. Do not rename or renumber historic receipts.
--
-- This migration updates ONLY the receipt number length check.
-- Cash drawer, inventory, finance GL, VOID and idempotency remain unchanged.
ALTER TABLE public.recycling_transactions
  DROP CONSTRAINT recycling_transactions_receipt_no_check,
  ADD CONSTRAINT recycling_transactions_receipt_no_check
    CHECK (length(receipt_no) >= 8 AND length(receipt_no) <= 90);

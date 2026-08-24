-- Trigger functions are invoked by PostgreSQL triggers and must not be callable as public RPCs.
revoke all on function public.capture_fg0003_qr_review_timeline() from public, anon, authenticated;
revoke all on function public.capture_fg0003_bill_timeline() from public, anon, authenticated;
revoke all on function public.capture_fg0003_item_cancel_timeline() from public, anon, authenticated;

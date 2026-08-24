-- Do not let the internal POS/kitchen confirmation row look like a second customer review event.
drop trigger if exists trg_capture_fg0003_qr_review_timeline on public.table_qr_orders;
create trigger trg_capture_fg0003_qr_review_timeline
after update of review_status on public.table_qr_orders
for each row
when (coalesce(new.payload->>'source', '') <> 'fg0003_pos_review_internal')
execute function public.capture_fg0003_qr_review_timeline();

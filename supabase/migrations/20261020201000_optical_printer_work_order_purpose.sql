-- Optical work-order print purpose extends, but never replaces, normal restaurant
-- receipt/kitchen/bar/drink or cash-drawer assignments.
alter table public.printer_device_assignments
 drop constraint if exists printer_device_assignments_purpose_check;
alter table public.printer_device_assignments
 add constraint printer_device_assignments_purpose_check check (
 purpose=any(array['receipt','kitchen','drink','bar','reprint','shift_report',
                   'payment_slip','cash_drawer','work_order']::text[])
 );

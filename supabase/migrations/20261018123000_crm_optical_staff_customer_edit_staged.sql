-- STAGED ONLY. Grant Owner-delegated employee rights to edit Optical customer
-- and create a new eye-exam record. Never change historical prescriptions.
-- Effective only after 20261018113000_crm_optical_owner_staff_permissions_staged.sql.
begin;
CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id)
     and not app.crm_staff_permission_allowed(
       p_tenant_id,p_branch_id,'main.crm_optical_customers',true) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;
commit;

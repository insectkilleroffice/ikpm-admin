-- IKPM update: a meeting / inspection can have SEVERAL attendees, from any staff
-- (admin can assign themself too). Keeps all data; an existing single attendee
-- is moved into the new list.
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again.

begin;

-- 1. attendee_id (one person) → attendee_ids (a list). attendee_name keeps the
--    names for display, e.g. "Ali Raza, Sara Khan".
alter table public.lead_activities
  add column if not exists attendee_ids uuid[] not null default '{}';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'lead_activities' and column_name = 'attendee_id') then
    update public.lead_activities
       set attendee_ids = array[attendee_id]
     where attendee_id is not null and cardinality(attendee_ids) = 0;
    alter table public.lead_activities drop column attendee_id;
  end if;
end;
$$;

create index if not exists lead_activities_attendees_idx on public.lead_activities using gin (attendee_ids);

-- 2. Assign one or more people (any staff, incl. admin), with notes (required)
--    and the address (required, except for a meeting on call).
drop function if exists public.assign_attendee(uuid, uuid);
drop function if exists public.assign_attendee(uuid, uuid, text, text);
drop function if exists public.assign_attendee(uuid, uuid[], text, text);

create function public.assign_attendee(
  p_activity_id  uuid,
  p_attendee_ids uuid[],
  p_notes        text,
  p_address      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act     public.lead_activities%rowtype;
  v_ids     uuid[];
  v_names   text;
  v_found   int;
  v_notes   text := nullif(trim(coalesce(p_notes, '')), '');
  v_address text := nullif(trim(coalesce(p_address, '')), '');
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can assign attendees' using errcode = '42501';
  end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_attendee_ids, '{}')) as x where x is not null;
  if v_ids is null then
    raise exception 'Choose at least one person' using errcode = '22023';
  end if;
  if v_notes is null then
    raise exception 'Add notes for the attendees' using errcode = '22023';
  end if;

  select * into v_act from public.lead_activities where id = p_activity_id for update;
  if not found then
    raise exception 'Meeting / inspection not found' using errcode = 'P0002';
  end if;
  if v_act.kind not in ('meeting', 'call', 'inspection') then
    raise exception 'Only meetings and inspections have attendees' using errcode = '22023';
  end if;
  if v_act.report_submitted_at is not null then
    raise exception 'The report is already in; attendees can no longer change' using errcode = '22023';
  end if;
  if v_act.kind <> 'call' and v_address is null then
    raise exception 'Add the address' using errcode = '22023';
  end if;

  select count(*), string_agg(full_name, ', ' order by full_name)
    into v_found, v_names
    from public.profiles where id = any(v_ids);
  if v_found <> cardinality(v_ids) then
    raise exception 'Some of the selected people are not staff' using errcode = '22023';
  end if;

  update public.lead_activities
     set attendee_ids              = v_ids,
         attendee_name             = v_names,
         attendee_assigned_at      = now(),
         attendee_assigned_by_name = (select full_name from public.profiles where id = auth.uid()),
         attendee_notes            = v_notes,
         visit_address             = v_address
   where id = p_activity_id;
end;
$$;

revoke all on function public.assign_attendee(uuid, uuid[], text, text) from public, anon;
grant execute on function public.assign_attendee(uuid, uuid[], text, text) to authenticated;

-- 3. Report: any of the assigned people (or admin) can submit it.
create or replace function public.submit_report(p_activity_id uuid, p_report text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text := public.my_role();
  v_report text := nullif(trim(coalesce(p_report, '')), '');
  v_act    public.lead_activities%rowtype;
begin
  if v_report is null then
    raise exception 'Write the report first' using errcode = '22023';
  end if;

  select * into v_act from public.lead_activities where id = p_activity_id for update;
  if not found then
    raise exception 'Meeting / inspection not found' using errcode = 'P0002';
  end if;
  if v_act.kind not in ('meeting', 'call', 'inspection') then
    raise exception 'Reports are only for meetings and inspections' using errcode = '22023';
  end if;
  if v_role is distinct from 'admin' and not (v_uid = any(v_act.attendee_ids)) then
    raise exception 'Only an assigned attendee or admin can submit this report' using errcode = '42501';
  end if;
  if v_act.report_submitted_at is not null then
    raise exception 'A report was already submitted' using errcode = '22023';
  end if;

  update public.lead_activities
     set report              = v_report,
         report_by           = v_uid,
         report_by_name      = (select full_name from public.profiles where id = v_uid),
         report_submitted_at = now()
   where id = p_activity_id;
end;
$$;

revoke all on function public.submit_report(uuid, text) from public, anon;
grant execute on function public.submit_report(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

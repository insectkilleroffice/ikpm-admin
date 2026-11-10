-- !! ALREADY APPLIED / SUPERSEDED — do not run again after patch-multi-attendees.sql
--    (it would bring back the old single-attendee function).
-- IKPM update: assign attendee with notes + address; notes required on every step.
-- Run on a database already set up with fresh-start.sql (keeps all data).
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again.

begin;

-- 1. New fields on meetings / inspections
alter table public.lead_activities
  add column if not exists attendee_notes text,   -- admin's notes for the attendee
  add column if not exists visit_address  text;   -- where to go (not needed for a call)

-- 2. Log contact / move a lead: notes now required on every step
create or replace function public.log_lead_activity(
  p_lead_id      uuid,
  p_kind         text,
  p_scheduled_at timestamptz default null,
  p_notes        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text := public.my_role();
  v_name  text;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_wrong boolean := p_kind = 'wrong_lead';
  v_lead  public.leads%rowtype;
begin
  if v_uid is null or coalesce(v_role, '') not in ('admin', 'sales') then
    raise exception 'Only admin and sales can log contact' using errcode = '42501';
  end if;
  if coalesce(p_kind, '') not in ('follow_up', 'call', 'meeting', 'inspection', 'proposal', 'wrong_lead') then
    raise exception 'Unknown activity type' using errcode = '22023';
  end if;
  if p_kind in ('follow_up', 'call', 'meeting', 'inspection') and p_scheduled_at is null then
    raise exception 'Choose a date and time' using errcode = '22023';
  end if;
  if v_notes is null then
    raise exception '%', case when v_wrong then 'Add a note explaining why' else 'Add notes' end using errcode = '22023';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if v_wrong and v_lead.stage <> 'new' then
    raise exception 'Only new leads can be marked as wrong lead' using errcode = '22023';
  end if;

  if v_role = 'sales' then
    if not coalesce(
         v_lead.assigned_to = v_uid
         or (v_lead.stage = 'new' and v_lead.assigned_to is null
             and (v_lead.added_by = v_uid or public.is_team_lead(v_lead.added_by))),
         false) then
      raise exception 'This lead belongs to another sales person' using errcode = '42501';
    end if;
    if v_lead.stage not in ('new', 'follow_up') then
      raise exception 'Only admin can move a lead out of Meeting, Inspection or Proposal' using errcode = '42501';
    end if;
  end if;

  select full_name into v_name from public.profiles where id = v_uid;

  insert into public.lead_activities (lead_id, kind, scheduled_at, notes, created_by, created_by_name)
  values (p_lead_id, p_kind, case when v_wrong then null else p_scheduled_at end, v_notes, v_uid, v_name);

  update public.leads
     set stage            = case when v_wrong then 'closed' else p_kind end,
         closed_reason    = case when v_wrong then 'wrong_lead' end,
         next_action_at   = case when v_wrong then null else p_scheduled_at end,
         assigned_to      = case when v_wrong then assigned_to else coalesce(assigned_to, v_uid) end,
         assigned_to_name = case when not v_wrong and assigned_to is null then v_name else assigned_to_name end,
         rejected_at      = case when p_kind = 'follow_up' then rejected_at end,
         updated_at       = now()
   where id = p_lead_id;
end;
$$;

-- 3. Assign attendee: now with notes (required) and address (required, except on call)
drop function if exists public.assign_attendee(uuid, uuid);

create or replace function public.assign_attendee(
  p_activity_id uuid,
  p_attendee_id uuid,
  p_notes       text,
  p_address     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act      public.lead_activities%rowtype;
  v_attendee public.profiles%rowtype;
  v_notes    text := nullif(trim(coalesce(p_notes, '')), '');
  v_address  text := nullif(trim(coalesce(p_address, '')), '');
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can assign attendees' using errcode = '42501';
  end if;
  if v_notes is null then
    raise exception 'Add notes for the attendee' using errcode = '22023';
  end if;

  select * into v_act from public.lead_activities where id = p_activity_id for update;
  if not found then
    raise exception 'Meeting / inspection not found' using errcode = 'P0002';
  end if;
  if v_act.kind not in ('meeting', 'call', 'inspection') then
    raise exception 'Only meetings and inspections have attendees' using errcode = '22023';
  end if;
  if v_act.report_submitted_at is not null then
    raise exception 'The report is already in; the attendee can no longer change' using errcode = '22023';
  end if;
  if v_act.kind <> 'call' and v_address is null then
    raise exception 'Add the address' using errcode = '22023';
  end if;

  select * into v_attendee from public.profiles where id = p_attendee_id;
  if not found or v_attendee.role not in ('sales', 'operations') then
    raise exception 'Choose someone from Sales or Operations' using errcode = '22023';
  end if;

  update public.lead_activities
     set attendee_id               = v_attendee.id,
         attendee_name             = v_attendee.full_name,
         attendee_assigned_at      = now(),
         attendee_assigned_by_name = (select full_name from public.profiles where id = auth.uid()),
         attendee_notes            = v_notes,
         visit_address             = v_address
   where id = p_activity_id;
end;
$$;

revoke all on function public.assign_attendee(uuid, uuid, text, text) from public, anon;
grant execute on function public.assign_attendee(uuid, uuid, text, text) to authenticated;

-- 4. Proposal status: notes required for sent / accepted / rejected
create or replace function public.set_proposal_status(
  p_proposal_id  uuid,
  p_status       text,
  p_reason       text default null,
  p_follow_up_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_p      public.proposals%rowtype;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can change a proposal' using errcode = '42501';
  end if;

  select * into v_p from public.proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  if not ((v_p.status = 'draft' and p_status = 'sent')
       or (v_p.status = 'sent'  and p_status in ('accepted', 'rejected'))) then
    raise exception 'Cannot change a % proposal to %', v_p.status, coalesce(p_status, '?') using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception '%', case when p_status = 'rejected' then 'Write why the client rejected it' else 'Add notes' end
      using errcode = '22023';
  end if;
  if p_status = 'rejected' and p_follow_up_at is null then
    raise exception 'Choose a follow-up date and time' using errcode = '22023';
  end if;

  update public.proposals
     set status     = p_status,
         sent_at    = case when p_status = 'sent' then now() else sent_at end,
         updated_at = now()
   where id = p_proposal_id;

  select full_name into v_name from public.profiles where id = v_uid;

  insert into public.lead_activities (lead_id, kind, scheduled_at, notes, created_by, created_by_name)
  values (
    v_p.lead_id,
    'proposal_' || p_status,
    case when p_status = 'rejected' then p_follow_up_at end,
    v_reason,
    v_uid,
    coalesce(v_name, 'Admin')
  );

  if p_status = 'rejected' then
    update public.leads
       set stage          = 'follow_up',
           closed_reason  = null,
           next_action_at = p_follow_up_at,
           rejected_at    = now(),
           updated_at     = now()
     where id = v_p.lead_id;
  else
    update public.leads set updated_at = now() where id = v_p.lead_id;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';

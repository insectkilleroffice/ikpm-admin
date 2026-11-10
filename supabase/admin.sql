-- IKPM ADMIN add-on for the shared Supabase database
-- ---------------------------------------------------------------------------
-- The sales app (ikpm-new/supabase/schema.sql) creates profiles, leads and
-- lead_activities. This file only ADDS what the admin app needs on top:
--
--   * lead_activities  + who attends a meeting / inspection, and their report
--                      + history kinds: proposal_sent / _accepted / _rejected
--   * proposals        proposal letters admin writes (draft → sent → accepted/rejected)
--   * assign_attendee()      admin picks who attends a meeting / inspection
--   * submit_report()        attendee (or admin on their behalf) files the report
--   * set_proposal_status()  admin marks a proposal sent / accepted / rejected,
--                            and it is written to the lead's history
--
-- It does not change any sales-app table policy or function, so the sales app
-- keeps working exactly as before.
--
-- HOW TO RUN: Supabase → SQL Editor → New query → paste this whole file → Run.
-- Run it AFTER the sales app's schema.sql. Safe to run again any time (and run
-- it again if you ever re-run the sales schema.sql).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.leads') is null
     or to_regclass('public.lead_activities') is null
     or to_regprocedure('public.my_role()') is null then
    raise exception 'Run ikpm-new/supabase/schema.sql first, then this file.';
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- 1. Attendee + report on meetings / inspections
-------------------------------------------------------------------------------
alter table public.lead_activities
  add column if not exists attendee_ids              uuid[] not null default '{}',  -- one or more staff
  add column if not exists attendee_name             text,                          -- their names
  add column if not exists attendee_assigned_at      timestamptz,
  add column if not exists attendee_assigned_by_name text,
  add column if not exists report                    text,
  add column if not exists report_by                 uuid references auth.users (id),
  add column if not exists report_by_name            text,
  add column if not exists report_submitted_at       timestamptz,
  add column if not exists attendee_notes            text,
  add column if not exists visit_address             text;

-- Older single-attendee column → move into the list, then remove it.
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

-- Allow the proposal events in the lead history.
alter table public.lead_activities drop constraint if exists lead_activities_kind_check;
alter table public.lead_activities add constraint lead_activities_kind_check check (kind in (
  'follow_up', 'call', 'meeting', 'inspection', 'proposal', 'wrong_lead', 'already_working',
  'proposal_sent', 'proposal_accepted', 'proposal_rejected'
));

-- Admin picks (or changes) who attends a meeting / inspection: one or more
-- people from any staff (admin can assign themself), with notes (required) and
-- the address (required, except for a meeting on call).
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

-- The attendee (or admin on their behalf) files the meeting / inspection report.
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

-------------------------------------------------------------------------------
-- 2. Proposals (admin only)
-------------------------------------------------------------------------------
create sequence if not exists public.proposal_number_seq start 1001;

-- An older, different `proposals` table may already exist. If it is missing any
-- column this app needs, keep it (and its data) as proposals_old and start fresh.
do $$
declare
  v_needed text[] := array['id', 'code', 'lead_id', 'title', 'proposal_date', 'client_name', 'client_address',
    'attention_name', 'attention_designation', 'subject', 'intro', 'scope', 'terms', 'plans', 'tenure_start',
    'tenure_end', 'payment_terms', 'closing', 'currency', 'total', 'status', 'created_by_name', 'created_at',
    'updated_at', 'sent_at'];
  v_old text := 'proposals_old';
  v_i   int := 1;
begin
  if to_regclass('public.proposals') is not null and exists (
       select 1 from unnest(v_needed) c
        where not exists (select 1 from information_schema.columns
                           where table_schema = 'public' and table_name = 'proposals' and column_name = c)) then
    while to_regclass('public.' || v_old) is not null loop
      v_i := v_i + 1;
      v_old := 'proposals_old' || v_i;
    end loop;
    execute format('alter table public.proposals rename to %I', v_old);
    if to_regclass('public.proposals_lead_idx') is not null then
      execute format('alter index public.proposals_lead_idx rename to %I', v_old || '_lead_idx');
    end if;
    raise notice 'Old proposals table kept as public.%', v_old;
  end if;
end;
$$;

-- Remove any older versions of the admin functions (a different signature would clash).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_proposal_status'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end;
$$;

create table if not exists public.proposals (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique default ('PR-' || nextval('public.proposal_number_seq')),
  lead_id               uuid not null references public.leads (id) on delete cascade,
  title                 text,
  proposal_date         date not null default current_date,
  client_name           text,
  client_address        text,
  attention_name        text,
  attention_designation text,
  subject               text,
  intro                 text,
  scope                 text,           -- one point per line
  terms                 text,           -- one point per line
  plans                 jsonb not null default '[]'::jsonb,
  tenure_start          date,
  tenure_end            date,
  payment_terms         text,
  closing               text,
  currency              text not null default 'PKR',
  total                 numeric(14, 2) not null default 0,
  status                text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected')),
  created_by            uuid references auth.users (id) default auth.uid(),
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  sent_at               timestamptz,
  constraint proposal_tenure_order check (tenure_start is null or tenure_end is null or tenure_end >= tenure_start)
);

create index if not exists proposals_lead_idx on public.proposals (lead_id, created_at desc);

alter table public.proposals enable row level security;

-- Start clean so a leftover policy can't leak rows (only on the proposals table).
do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'proposals' loop
    execute format('drop policy %I on public.proposals', r.policyname);
  end loop;
end;
$$;

create policy "Admin views proposals"
  on public.proposals for select to authenticated
  using (public.my_role() = 'admin');

create policy "Admin creates draft proposals"
  on public.proposals for insert to authenticated
  with check (public.my_role() = 'admin' and status = 'draft');

-- Only drafts can be edited, and status can't be changed here (use set_proposal_status).
create policy "Admin edits draft proposals"
  on public.proposals for update to authenticated
  using (public.my_role() = 'admin' and status = 'draft')
  with check (public.my_role() = 'admin' and status = 'draft');

create policy "Admin deletes draft proposals"
  on public.proposals for delete to authenticated
  using (public.my_role() = 'admin' and status = 'draft');

-- "Rejected" tag on a lead (set when a proposal is rejected; the sales app clears it
-- once the lead moves on from Follow-up).
alter table public.leads add column if not exists rejected_at timestamptz;

-- draft → sent → accepted / rejected. Each change is added to the lead's history.
-- Rejected needs a reason + follow-up date: the lead goes back to Follow-up on the
-- salesperson's board, tagged "Rejected".
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

  -- History: just the event; for a rejection also the reason and follow-up date.
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

revoke all on function public.set_proposal_status(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.set_proposal_status(uuid, text, text, timestamptz) to authenticated;

-- Check after running:
--   select policyname from pg_policies where tablename = 'proposals';   -- 4 rows
--   select proname from pg_proc where proname in ('assign_attendee', 'submit_report', 'set_proposal_status'); -- 3 rows

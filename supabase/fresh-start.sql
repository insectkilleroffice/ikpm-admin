-- =============================================================================
-- IKPM — FRESH START (both apps: ikpm-new sales app + ikpm-admin)
-- =============================================================================
-- !! DELETES ALL DATA in the public schema: leads, history, proposals and any
--    leftover tables / functions / views from earlier attempts.
-- KEEPS: login users (auth.users) and their staff profiles (name, email, role).
--
-- Run: Supabase → SQL Editor → New query → paste this whole file → Run.
-- It runs as one transaction: if any step fails, nothing is changed.
--
-- Flow it supports
--   1. Sales adds a lead (Leads tab, stage = new) and claims it by logging contact
--      → follow_up / meeting (in person or on call) / inspection / proposal.
--   2. Sales can only move leads while New or in Follow-up; after that admin
--      moves them (any step, incl. back to Follow-up). Every move = history row.
--   3. Admin assigns who attends a meeting / inspection: one or more staff
--      (any role, incl. the admin themself), with address + notes.
--   4. Any attendee (or admin on their behalf) submits the report.
--   5. Admin writes the proposal: draft → sent → accepted / rejected.
--      Each status change is added to the lead's history.
-- =============================================================================

begin;

-------------------------------------------------------------------------------
-- 0. Save staff profiles, then remove everything else from `public`
-------------------------------------------------------------------------------
create schema if not exists ikpm_keep;
drop table if exists ikpm_keep.profiles;
create table ikpm_keep.profiles (id uuid, full_name text, email text, role text);

do $$
begin
  if to_regclass('public.profiles') is not null then
    insert into ikpm_keep.profiles (id, full_name, email, role)
    select id, full_name, email, role from public.profiles;
  end if;
end;
$$;

do $$
declare
  v_list text[];
  v_obj  text;
begin
  -- views
  select array_agg(format('%I.%I', n.nspname, c.relname)) into v_list
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  foreach v_obj in array coalesce(v_list, '{}') loop
    execute 'drop view if exists ' || v_obj || ' cascade';
  end loop;

  -- materialized views
  select array_agg(format('%I.%I', n.nspname, c.relname)) into v_list
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'm'
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  foreach v_obj in array coalesce(v_list, '{}') loop
    execute 'drop materialized view if exists ' || v_obj || ' cascade';
  end loop;

  -- tables
  select array_agg(format('%I.%I', n.nspname, c.relname)) into v_list
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'f')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  foreach v_obj in array coalesce(v_list, '{}') loop
    execute 'drop table if exists ' || v_obj || ' cascade';
  end loop;

  -- sequences
  select array_agg(format('%I.%I', n.nspname, c.relname)) into v_list
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  foreach v_obj in array coalesce(v_list, '{}') loop
    execute 'drop sequence if exists ' || v_obj || ' cascade';
  end loop;

  -- functions / procedures (also removes triggers that use them, e.g. on auth.users)
  select array_agg(format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))) into v_list
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  foreach v_obj in array coalesce(v_list, '{}') loop
    execute 'drop routine if exists ' || v_obj || ' cascade';
  end loop;

  -- enum / domain / standalone composite types
  select array_agg(format('%I.%I', n.nspname, t.typname)) into v_list
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
     and (t.typtype in ('e', 'd')
          or (t.typtype = 'c' and (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c'))
     and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e');
  foreach v_obj in array coalesce(v_list, '{}') loop
    execute 'drop type if exists ' || v_obj || ' cascade';
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- 1. Staff profiles
-------------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (length(trim(full_name)) > 0),
  email      text not null,
  role       text not null check (role in ('admin', 'operations', 'sales', 'finance')),
  created_at timestamptz not null default now()
);

create function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

alter table public.profiles enable row level security;

create policy "View own profile or admin views all"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');

-- Put the saved staff back (only those who still have a login).
insert into public.profiles (id, full_name, email, role)
select k.id,
       coalesce(nullif(trim(k.full_name), ''), u.email),
       coalesce(nullif(trim(k.email), ''), u.email),
       case when lower(trim(k.role)) in ('admin', 'operations', 'sales', 'finance')
            then lower(trim(k.role)) else 'operations' end
  from ikpm_keep.profiles k
  join auth.users u on u.id = k.id
on conflict (id) do nothing;

drop schema ikpm_keep cascade;

-------------------------------------------------------------------------------
-- 2. Leads
-------------------------------------------------------------------------------
create sequence public.lead_number_seq start 1001;

create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique default ('LD-' || nextval('public.lead_number_seq')),
  type             text not null check (type in ('Residential', 'Company')),
  name             text not null check (length(trim(name)) > 0),
  company_name     text,
  phone            text not null check (length(trim(phone)) > 0),
  email            text,
  source           text not null check (length(trim(source)) > 0),
  added_by         uuid references auth.users (id),            -- null = System
  added_by_name    text not null,
  stage            text not null default 'new'
                     check (stage in ('new', 'follow_up', 'call', 'meeting', 'inspection', 'proposal', 'closed')),
  assigned_to      uuid references public.profiles (id) on delete set null,
  assigned_to_name text,
  next_action_at   timestamptz,
  closed_reason    text check (closed_reason in ('wrong_lead', 'already_working')),
  rejected_at      timestamptz,   -- proposal rejected → back in Follow-up, tagged "Rejected"
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint company_needs_name check (type <> 'Company' or length(trim(coalesce(company_name, ''))) > 0),
  constraint closed_needs_reason check ((stage = 'closed') = (closed_reason is not null))
);

create index leads_created_at_idx  on public.leads (created_at desc);
create index leads_added_by_idx    on public.leads (added_by);
create index leads_assigned_to_idx on public.leads (assigned_to);
create index leads_stage_idx       on public.leads (stage);

-- New leads start unclaimed; "Added by" is the signed-in user (or "System").
create function public.set_lead_added_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.stage            := 'new';
  new.assigned_to      := null;
  new.assigned_to_name := null;
  new.next_action_at   := null;
  new.closed_reason    := null;
  new.rejected_at      := null;
  new.created_at       := now();
  new.updated_at       := now();
  new.added_by         := auth.uid();

  if new.added_by is null then
    new.added_by_name := coalesce(nullif(trim(new.added_by_name), ''), 'System');
  else
    select coalesce(p.full_name, u.email)
      into new.added_by_name
      from auth.users u
      left join public.profiles p on p.id = u.id
     where u.id = new.added_by;
  end if;
  return new;
end;
$$;

create trigger leads_set_added_by
  before insert on public.leads
  for each row execute function public.set_lead_added_by();

-- Shared with the whole sales team = added by the system or by an admin.
create function public.is_team_lead(p_added_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_added_by is null
      or exists (select 1 from public.profiles where id = p_added_by and role = 'admin');
$$;

alter table public.leads enable row level security;

create policy "Staff can view leads"
  on public.leads for select to authenticated
  using (
    public.my_role() = 'admin'
    or (
      public.my_role() = 'sales'
      and (
        assigned_to = auth.uid()
        or (stage = 'new' and assigned_to is null
            and (added_by = auth.uid() or public.is_team_lead(added_by)))
      )
    )
  );

create policy "Staff can add leads"
  on public.leads for insert to authenticated
  with check (public.my_role() in ('admin', 'sales'));

-- No update/delete policies: leads only change through the functions below.

-------------------------------------------------------------------------------
-- 3. Lead history (every step, attendee, report and proposal event)
-------------------------------------------------------------------------------
create table public.lead_activities (
  id                        uuid primary key default gen_random_uuid(),
  lead_id                   uuid not null references public.leads (id) on delete cascade,
  kind                      text not null check (kind in (
                              'follow_up', 'call', 'meeting', 'inspection', 'proposal',
                              'wrong_lead', 'already_working',
                              'proposal_sent', 'proposal_accepted', 'proposal_rejected')),
  scheduled_at              timestamptz,
  notes                     text,
  created_by                uuid references auth.users (id),
  created_by_name           text not null,                     -- "Moved by"
  created_at                timestamptz not null default now(),
  -- meetings / inspections only
  attendee_ids              uuid[] not null default '{}',      -- one or more staff (any role)
  attendee_name             text,                              -- their names, e.g. "Ali Raza, Sara Khan"
  attendee_assigned_at      timestamptz,
  attendee_assigned_by_name text,
  attendee_notes            text,                              -- admin's notes for the attendee
  visit_address             text,                              -- where to go (not needed for a call)
  report                    text,
  report_by                 uuid references auth.users (id),
  report_by_name            text,
  report_submitted_at       timestamptz
);

create index lead_activities_lead_idx     on public.lead_activities (lead_id, created_at desc);
create index lead_activities_attendees_idx on public.lead_activities using gin (attendee_ids);

alter table public.lead_activities enable row level security;

create policy "View activity of visible leads"
  on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

-- Log a step on a lead and move it to that stage.
--   follow_up / call / meeting / inspection → date & time required
--   proposal                                → date optional
--   wrong_lead                              → only on a new lead
--   every step                              → notes required
-- Logging on a new lead claims it. Sales can only move New / Follow-up leads.
create function public.log_lead_activity(
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
         -- "Rejected" tag stays while the lead is in Follow-up, clears once it moves on.
         rejected_at      = case when p_kind = 'follow_up' then rejected_at end,
         updated_at       = now()
   where id = p_lead_id;
end;
$$;

-- Admin picks (or changes) who attends a meeting / inspection: one or more
-- people from any staff (admin can assign themself), with notes (required) and
-- the address (required, except for a meeting on call).
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

-- The attendee (or admin on their behalf) submits the report.
create function public.submit_report(p_activity_id uuid, p_report text)
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

-------------------------------------------------------------------------------
-- 4. Proposals (admin only)
-------------------------------------------------------------------------------
create sequence public.proposal_number_seq start 1001;

create table public.proposals (
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

create index proposals_lead_idx on public.proposals (lead_id, created_at desc);

alter table public.proposals enable row level security;

create policy "Admin views proposals"
  on public.proposals for select to authenticated
  using (public.my_role() = 'admin');

create policy "Admin creates draft proposals"
  on public.proposals for insert to authenticated
  with check (public.my_role() = 'admin' and status = 'draft');

create policy "Admin edits draft proposals"
  on public.proposals for update to authenticated
  using (public.my_role() = 'admin' and status = 'draft')
  with check (public.my_role() = 'admin' and status = 'draft');

create policy "Admin deletes draft proposals"
  on public.proposals for delete to authenticated
  using (public.my_role() = 'admin' and status = 'draft');

-- draft → sent → accepted / rejected; each change goes into the lead's history.
-- Rejected needs a reason + follow-up date: the lead goes back to Follow-up on the
-- salesperson's board, tagged "Rejected".
create function public.set_proposal_status(
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
  -- Notes are required for every status change (for a rejection: the reason).
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

  -- History: the event + its notes; for a rejection also the follow-up date.
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

-------------------------------------------------------------------------------
-- 5. Who may call the functions (signed-in users only; each checks the role)
-------------------------------------------------------------------------------
revoke all on function public.log_lead_activity(uuid, text, timestamptz, text) from public, anon;
revoke all on function public.assign_attendee(uuid, uuid[], text, text)       from public, anon;
revoke all on function public.submit_report(uuid, text)                       from public, anon;
revoke all on function public.set_proposal_status(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.log_lead_activity(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.assign_attendee(uuid, uuid[], text, text)       to authenticated;
grant execute on function public.submit_report(uuid, text)                       to authenticated;
grant execute on function public.set_proposal_status(uuid, text, text, timestamptz) to authenticated;

grant select, insert                 on public.profiles, public.leads, public.lead_activities to authenticated;
grant select, insert, update, delete on public.proposals                                    to authenticated;
grant usage on sequence public.lead_number_seq, public.proposal_number_seq                  to authenticated;

commit;

-- Make the API see the new tables right away.
notify pgrst, 'reload schema';

-- Checks (run after):
--   select full_name, email, role from public.profiles;            -- your staff are still here
--   select tablename from pg_tables where schemaname = 'public';   -- profiles, leads, lead_activities, proposals
--
-- ADDING STAFF later (once per person):
--   a) Authentication → Users → Add user (email + password, tick "Auto Confirm User")
--   b) insert into public.profiles (id, full_name, email, role)
--      select id, 'Full Name', email, 'sales' from auth.users where email = 'person@example.com';
--   Roles: admin, sales, operations, finance.

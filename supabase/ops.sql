-- =============================================================================
-- IKPM — OPERATIONS DATABASE (schema "ops")
-- =============================================================================
-- Used by: ikpm-operation (Operations manager) and ikpm-admin (Operations page).
--
-- Kept apart from sales: everything lives in its own schema "ops".
-- Nothing in "public" (profiles, leads, lead_activities, proposals) is changed.
-- The only links to sales are optional: a client or a meeting can point to the
-- lead it came from (public.leads.id).
--
-- !! Running this file DELETES all operations data (drops schema "ops") and
--    builds it fresh. Sales data is not touched.
--
-- Run: Supabase → SQL Editor → New query → paste this whole file → Run.
-- Then: Settings → API → "Exposed schemas" → add  ops  → Save.
--
-- Flow
--   Complaint      lodged (admin or operations) → waits for admin.
--                  Admin decides: revisit / inspection / meeting / close.
--   Revisit        only exists because of a complaint decision. Admin sets the
--                  day and time; it waits (red) until operations picks the PCO.
--   New contract   admin adds the client + site and sets the first visit day;
--                  it waits (red) until operations picks the PCO. The site
--                  becomes active (shows in the client list) at that moment.
--   Meeting /      admin puts them straight on the calendar (no red stage).
--   inspection     The operations manager attends and writes the report.
--   Monthly        operations schedules the next month for a site, only when
--                  every service visit of that site is done.
--   Service visit  start (3 checks) → close out with items, signed challan,
--                  photos. Client blocked / postponed → needs a new day (red).
--   Every change goes through the functions below; nobody edits rows directly.
-- =============================================================================

begin;

drop schema if exists ops cascade;
create schema ops;

grant usage on schema ops to authenticated;
revoke all on schema ops from anon;

-------------------------------------------------------------------------------
-- 0. Helpers
-------------------------------------------------------------------------------
-- Today in Pakistan, so "today" is the same for everyone.
create function ops.today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Karachi')::date $$;

-- Admin and Operations can see and run operations.
create function ops.can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce(public.my_role(), '') in ('admin', 'operations') $$;

create function ops.require(p_roles text[], p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not (coalesce(public.my_role(), '') = any (p_roles)) then
    raise exception 'Only % can %', array_to_string(p_roles, ' or '), p_what using errcode = '42501';
  end if;
end;
$$;

create function ops.me_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(p.full_name), ''), u.email, 'System')
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = auth.uid()
$$;

create function ops.check_time(p_time text)
returns void
language plpgsql
immutable
as $$
begin
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Pick a time' using errcode = '22023';
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- 1. Field team (supervisors and PCOs). They do not need a login.
-------------------------------------------------------------------------------
create table ops.staff (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null unique check (length(trim(full_name)) > 0),
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- 2. Clients and sites
-------------------------------------------------------------------------------
create table ops.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique check (length(trim(name)) > 0),
  code            text not null unique,              -- job code prefix, e.g. ALN → IKPM-ALN-JOB-001
  job_seq         integer not null default 0,        -- last job number used
  lead_id         uuid unique references public.leads (id) on delete set null,  -- won lead (optional)
  created_by_name text not null,
  created_at      timestamptz not null default now()
);

-- Job code prefix: first 3 letters of the name; a number is added if taken.
create function ops.set_client_code()
returns trigger
language plpgsql
as $$
declare
  v_base text := upper(left(regexp_replace(new.name, '[^A-Za-z]', '', 'g'), 3));
  v_code text;
  v_n    integer := 1;
begin
  if v_base = '' then v_base := 'CLI'; end if;
  v_code := v_base;
  while exists (select 1 from ops.clients where code = v_code) loop
    v_n := v_n + 1;
    v_code := v_base || v_n;
  end loop;
  new.code := v_code;
  return new;
end;
$$;

create trigger clients_set_code before insert on ops.clients
  for each row execute function ops.set_client_code();

create table ops.sites (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references ops.clients (id) on delete restrict,
  name             text not null check (length(trim(name)) > 0),
  city             text,
  address          text,
  visits_per_month integer not null check (visits_per_month between 1 and 8),
  supervisor_id    uuid references ops.staff (id) on delete set null,   -- usual supervisor
  status           text not null default 'pending' check (status in ('pending', 'active')),
  created_at       timestamptz not null default now(),
  unique (client_id, name)
);

create index sites_client_idx on ops.sites (client_id);

-------------------------------------------------------------------------------
-- 3. Complaints (admin decides what happens)
-------------------------------------------------------------------------------
create sequence ops.complaint_number_seq start 1001;

create table ops.complaints (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default ('CMP-' || nextval('ops.complaint_number_seq')),
  site_id         uuid not null references ops.sites (id) on delete cascade,
  description     text not null check (length(trim(description)) > 0),
  severity        text not null check (severity in ('Low', 'Medium', 'High')),
  lodged_by       uuid references auth.users (id),
  lodged_by_name  text not null,
  lodged_at       timestamptz not null default now(),
  -- open        → waiting for admin
  -- in_progress → admin sent a revisit / inspection / meeting, not done yet
  -- resolved    → that visit is done
  -- closed      → admin closed it without a visit
  status          text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  decision        text check (decision in ('revisit', 'inspection', 'meeting', 'closed')),
  decision_note   text,
  decided_by_name text,
  decided_at      timestamptz,
  constraint decision_matches_status check ((status = 'open') = (decision is null))
);

create index complaints_site_idx   on ops.complaints (site_id, lodged_at desc);
create index complaints_status_idx on ops.complaints (status);

-------------------------------------------------------------------------------
-- 4. Visits (service visits, meetings, inspections)
-------------------------------------------------------------------------------
create table ops.visits (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('monthly', 'contract', 'revisit', 'meeting', 'inspection')),
  site_id         uuid references ops.sites (id) on delete cascade,
  prospect_name   text,                                                     -- meeting / inspection for a lead
  lead_id         uuid references public.leads (id) on delete set null,     -- optional link to sales
  complaint_id    uuid references ops.complaints (id) on delete restrict,
  job_code        text unique,                                              -- service visits only
  source          text not null check (source in ('admin', 'ops')),
  -- needs_pco     → admin set the day; operations must pick the PCO (red)
  -- scheduled     → on the calendar
  -- started       → PCO started the visit
  -- needs_new_day → not done (client blocked / postponed); keeps its old day (red)
  -- done          → report in
  status          text not null check (status in ('needs_pco', 'scheduled', 'started', 'needs_new_day', 'done')),
  visit_date      date not null,
  visit_time      text not null check (visit_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  supervisor_id   uuid references ops.staff (id) on delete set null,   -- leads a service visit
  crew_ids        uuid[] not null default '{}',                        -- other people going
  guests          text,                                                -- client people (meetings / inspections)
  note            text,
  started_at      timestamptz,
  before_photos   text[] not null default '{}',                        -- storage paths
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint site_or_lead check ((site_id is not null) <> (length(trim(coalesce(prospect_name, ''))) > 0)),
  constraint service_needs_site check (kind in ('meeting', 'inspection') or site_id is not null),
  constraint revisit_needs_complaint check (kind <> 'revisit' or complaint_id is not null),
  constraint only_service_needs_pco check (status <> 'needs_pco' or kind in ('contract', 'revisit')),
  constraint team_for_service check (status in ('needs_pco') or kind in ('meeting', 'inspection') or supervisor_id is not null)
);

create index visits_site_idx   on ops.visits (site_id, visit_date);
create index visits_date_idx   on ops.visits (visit_date);
create index visits_status_idx on ops.visits (status);

-- Service visits get a job code per client: IKPM-ALN-JOB-001, -002, …
create function ops.set_job_code()
returns trigger
language plpgsql
as $$
declare
  v_code text;
  v_seq  integer;
begin
  if new.kind in ('monthly', 'contract', 'revisit') then
    update ops.clients c
       set job_seq = c.job_seq + 1
      from ops.sites s
     where s.id = new.site_id and c.id = s.client_id
    returning c.code, c.job_seq into v_code, v_seq;
    new.job_code := 'IKPM-' || v_code || '-JOB-' || lpad(v_seq::text, 3, '0');
  else
    new.job_code := null;
  end if;
  return new;
end;
$$;

create trigger visits_set_job_code before insert on ops.visits
  for each row execute function ops.set_job_code();

create function ops.touch()
returns trigger
language plpgsql
as $$ begin new.updated_at := now(); return new; end; $$;

create trigger visits_touch before update on ops.visits
  for each row execute function ops.touch();

-- Every reschedule (and every "client blocked / postponed") is kept.
create table ops.visit_history (
  id        uuid primary key default gen_random_uuid(),
  visit_id  uuid not null references ops.visits (id) on delete cascade,
  from_date date not null,
  from_time text not null,
  reason    text not null,
  note      text,
  by_name   text not null,
  at        timestamptz not null default now()
);

create index visit_history_visit_idx on ops.visit_history (visit_id, at);

-------------------------------------------------------------------------------
-- 5. Reports
-------------------------------------------------------------------------------
create table ops.service_reports (
  visit_id          uuid primary key references ops.visits (id) on delete cascade,
  outcome           text not null check (outcome in ('completed', 'partial')),
  team_ids          uuid[] not null check (cardinality(team_ids) > 0),   -- who did the work (payroll)
  items             jsonb not null default '[]',   -- [{ "name": "...", "qty": 200, "unit": "ml" }]
  extras            jsonb not null default '[]',   -- [{ "work": "...", "charge": 3500 }]  charge before tax
  findings          text[] not null default '{}',
  notes             text,
  found_photos      text[] not null default '{}',
  after_photos      text[] not null default '{}',
  challan_no        text not null check (length(trim(challan_no)) > 0),
  challan_date      date not null,
  challan_file      text not null,                -- storage path of the signed challan
  submitted_by_name text not null,
  submitted_at      timestamptz not null default now()
);

-- One physical challan can only be used once.
create unique index service_reports_challan_idx on ops.service_reports (lower(trim(challan_no)));

create table ops.meeting_reports (
  visit_id        uuid primary key references ops.visits (id) on delete cascade,
  joined          text not null check (length(trim(joined)) > 0),
  outcome         text not null check (outcome in ('Client agreed', 'Needs another meeting', 'Client said no')),
  notes           text,
  written_by_name text not null,
  written_at      timestamptz not null default now()
);

-- Inspection reports of a client site are the site's "Inspection reports".
create table ops.inspection_reports (
  visit_id        uuid primary key references ops.visits (id) on delete cascade,
  activity        text not null check (activity in ('None', 'Low', 'Medium', 'High')),
  advice          text not null check (advice in ('No action needed', 'Treat again', 'Fix site conditions first')),
  areas           text not null check (length(trim(areas)) > 0),
  notes           text,
  written_by_name text not null,
  written_at      timestamptz not null default now()
);

-- Findings from service visits that the site still has to fix.
create table ops.site_issues (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references ops.sites (id) on delete cascade,
  description     text not null check (length(trim(description)) > 0),
  source_visit_id uuid references ops.visits (id) on delete set null,
  open            boolean not null default true,
  created_at      timestamptz not null default now(),
  fixed_at        timestamptz,
  fixed_by_name   text
);

create index site_issues_site_idx on ops.site_issues (site_id) where open;

-------------------------------------------------------------------------------
-- 6. Security: read for admin + operations; writes only through functions.
--    The field team list is the only table admin edits directly.
-------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['staff', 'clients', 'sites', 'complaints', 'visits', 'visit_history',
                           'service_reports', 'meeting_reports', 'inspection_reports', 'site_issues'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('create policy "Admin and operations can view" on ops.%I for select to authenticated using (ops.can_view())', t);
    execute format('grant select on ops.%I to authenticated', t);
  end loop;
end;
$$;

grant insert, update on ops.staff to authenticated;
create policy "Admin adds field team" on ops.staff for insert to authenticated
  with check (public.my_role() = 'admin');
create policy "Admin edits field team" on ops.staff for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-------------------------------------------------------------------------------
-- 7. Small checks used by the functions
-------------------------------------------------------------------------------
create function ops.check_team(p_supervisor uuid, p_crew uuid[], p_need_supervisor boolean)
returns void
language plpgsql
stable
as $$
begin
  if p_need_supervisor and p_supervisor is null then
    raise exception 'Pick the supervisor' using errcode = '22023';
  end if;
  if p_supervisor is not null and not exists (select 1 from ops.staff where id = p_supervisor and active) then
    raise exception 'That supervisor is not in the active field team' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_crew, '{}')) c where not exists (select 1 from ops.staff s where s.id = c and s.active)) then
    raise exception 'Someone in the team is not in the active field team' using errcode = '22023';
  end if;
end;
$$;

-- Crew without the supervisor and without repeats.
create function ops.clean_crew(p_supervisor uuid, p_crew uuid[])
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct c), '{}')
    from unnest(coalesce(p_crew, '{}')) c
   where p_supervisor is null or c <> p_supervisor
$$;

-- When the visit made for a complaint is done, the complaint is resolved.
create function ops.resolve_complaint(p_visit ops.visits)
returns void
language sql
as $$
  update ops.complaints set status = 'resolved'
   where id = p_visit.complaint_id and status = 'in_progress'
$$;

-------------------------------------------------------------------------------
-- 8. Complaints
-------------------------------------------------------------------------------
-- Who can lodge: admin and operations for now (one place to change later).
create function ops.lodge_complaint(p_site_id uuid, p_description text, p_severity text)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare v_id uuid;
begin
  perform ops.require(array['admin', 'operations'], 'lodge a complaint');
  if not exists (select 1 from ops.sites where id = p_site_id) then
    raise exception 'Site not found' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_description, ''))) = 0 then
    raise exception 'Write what the client complained about' using errcode = '22023';
  end if;
  if coalesce(p_severity, '') not in ('Low', 'Medium', 'High') then
    raise exception 'Pick how serious it is' using errcode = '22023';
  end if;
  insert into ops.complaints (site_id, description, severity, lodged_by, lodged_by_name)
  values (p_site_id, trim(p_description), p_severity, auth.uid(), ops.me_name())
  returning id into v_id;
  return v_id;
end;
$$;

-- Admin decides: revisit / inspection / meeting / close.
--   revisit            → revisit visit on the given day, waits for operations to pick the PCO
--   inspection/meeting → straight on the calendar, the operations manager attends
--   close              → nothing more happens (note required)
create function ops.decide_complaint(
  p_complaint_id uuid,
  p_decision     text,
  p_date         date default null,
  p_time         text default null,
  p_note         text default null,
  p_crew_ids     uuid[] default '{}',
  p_guests       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_c    ops.complaints%rowtype;
  v_id   uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform ops.require(array['admin'], 'decide on a complaint');
  select * into v_c from ops.complaints where id = p_complaint_id for update;
  if not found then raise exception 'Complaint not found' using errcode = 'P0002'; end if;
  if v_c.status <> 'open' then raise exception 'This complaint was already decided' using errcode = '22023'; end if;

  if p_decision = 'closed' then
    if v_note is null then raise exception 'Write why it is closed' using errcode = '22023'; end if;
    update ops.complaints
       set status = 'closed', decision = 'closed', decision_note = v_note,
           decided_by_name = ops.me_name(), decided_at = now()
     where id = v_c.id;
    return null;
  end if;

  if p_decision not in ('revisit', 'inspection', 'meeting') then
    raise exception 'Pick revisit, inspection, meeting or close' using errcode = '22023';
  end if;
  if p_date is null or p_date < ops.today() then
    raise exception 'Pick today or a later day' using errcode = '22023';
  end if;
  perform ops.check_time(p_time);

  if p_decision = 'revisit' then
    insert into ops.visits (kind, site_id, complaint_id, source, status, visit_date, visit_time, note, created_by_name)
    values ('revisit', v_c.site_id, v_c.id, 'admin', 'needs_pco', p_date, p_time,
            coalesce(v_note, v_c.description), ops.me_name())
    returning id into v_id;
  else
    perform ops.check_team(null, p_crew_ids, false);
    insert into ops.visits (kind, site_id, complaint_id, source, status, visit_date, visit_time,
                            crew_ids, guests, note, created_by_name)
    values (p_decision, v_c.site_id, v_c.id, 'admin', 'scheduled', p_date, p_time,
            ops.clean_crew(null, p_crew_ids), nullif(trim(coalesce(p_guests, '')), ''),
            coalesce(v_note, v_c.description), ops.me_name())
    returning id into v_id;
  end if;

  update ops.complaints
     set status = 'in_progress', decision = p_decision, decision_note = v_note,
         decided_by_name = ops.me_name(), decided_at = now()
   where id = v_c.id;
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- 9. Admin: new contracts, meetings, inspections
-------------------------------------------------------------------------------
-- New contract: client (new or existing) + new site + first visit (waits for a PCO).
create function ops.new_contract(
  p_client_id        uuid,
  p_client_name      text,
  p_lead_id          uuid,
  p_site_name        text,
  p_city             text,
  p_address          text,
  p_visits_per_month integer,
  p_supervisor_id    uuid,
  p_date             date,
  p_time             text,
  p_note             text
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_client uuid := p_client_id;
  v_site   uuid;
  v_id     uuid;
begin
  perform ops.require(array['admin'], 'send a new contract');
  if v_client is null then
    if length(trim(coalesce(p_client_name, ''))) = 0 then
      raise exception 'Write the client name' using errcode = '22023';
    end if;
    if exists (select 1 from ops.clients where lower(name) = lower(trim(p_client_name))) then
      raise exception 'This client already exists. Pick it from the list.' using errcode = '23505';
    end if;
    if p_lead_id is not null and exists (select 1 from ops.clients where lead_id = p_lead_id) then
      raise exception 'That lead is already linked to a client' using errcode = '23505';
    end if;
    insert into ops.clients (name, lead_id, created_by_name)
    values (trim(p_client_name), p_lead_id, ops.me_name())
    returning id into v_client;
  elsif not exists (select 1 from ops.clients where id = v_client) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  if length(trim(coalesce(p_site_name, ''))) = 0 then
    raise exception 'Write the site name' using errcode = '22023';
  end if;
  if exists (select 1 from ops.sites where client_id = v_client and lower(name) = lower(trim(p_site_name))) then
    raise exception 'This client already has a site with that name' using errcode = '23505';
  end if;
  if coalesce(p_visits_per_month, 0) not between 1 and 8 then
    raise exception 'Visits a month must be 1 to 8' using errcode = '22023';
  end if;
  perform ops.check_team(p_supervisor_id, '{}', false);
  if p_date is null or p_date < ops.today() then
    raise exception 'Pick today or a later day for the first visit' using errcode = '22023';
  end if;
  perform ops.check_time(p_time);

  insert into ops.sites (client_id, name, city, address, visits_per_month, supervisor_id)
  values (v_client, trim(p_site_name), nullif(trim(coalesce(p_city, '')), ''),
          nullif(trim(coalesce(p_address, '')), ''), p_visits_per_month, p_supervisor_id)
  returning id into v_site;

  insert into ops.visits (kind, site_id, source, status, visit_date, visit_time, note, created_by_name)
  values ('contract', v_site, 'admin', 'needs_pco', p_date, p_time,
          coalesce(nullif(trim(coalesce(p_note, '')), ''),
                   'New contract signed. ' || p_visits_per_month || ' visit' ||
                   case when p_visits_per_month = 1 then '' else 's' end || ' every month. First treatment.'),
          ops.me_name())
  returning id into v_id;
  return v_id;
end;
$$;

-- Meeting or inspection straight onto the calendar (no red stage).
-- For a client site, or for a lead that is not a client yet.
create function ops.assign_meeting(
  p_kind          text,
  p_site_id       uuid,
  p_prospect_name text,
  p_lead_id       uuid,
  p_date          date,
  p_time          text,
  p_crew_ids      uuid[],
  p_guests        text,
  p_note          text
)
returns uuid
language plpgsql
security definer
set search_path = ops, public
as $$
declare v_id uuid;
begin
  perform ops.require(array['admin'], 'assign meetings and inspections');
  if p_kind not in ('meeting', 'inspection') then
    raise exception 'Pick meeting or inspection' using errcode = '22023';
  end if;
  if p_site_id is null and length(trim(coalesce(p_prospect_name, ''))) = 0 then
    raise exception 'Pick the site or write the name of the lead' using errcode = '22023';
  end if;
  if p_site_id is not null and not exists (select 1 from ops.sites where id = p_site_id) then
    raise exception 'Site not found' using errcode = 'P0002';
  end if;
  if p_date is null or p_date < ops.today() then
    raise exception 'Pick today or a later day' using errcode = '22023';
  end if;
  perform ops.check_time(p_time);
  perform ops.check_team(null, p_crew_ids, false);

  insert into ops.visits (kind, site_id, prospect_name, lead_id, source, status, visit_date, visit_time,
                          crew_ids, guests, note, created_by_name)
  values (p_kind, p_site_id,
          case when p_site_id is null then trim(p_prospect_name) end,
          case when p_site_id is null then p_lead_id end,
          'admin', 'scheduled', p_date, p_time, ops.clean_crew(null, p_crew_ids),
          nullif(trim(coalesce(p_guests, '')), ''), nullif(trim(coalesce(p_note, '')), ''), ops.me_name())
  returning id into v_id;
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- 10. Operations manager
-------------------------------------------------------------------------------
-- Pick the PCO for a red request (contract / revisit). Keeps admin's day and time.
create function ops.assign_pco(p_visit_id uuid, p_supervisor_id uuid, p_crew_ids uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare v ops.visits%rowtype;
begin
  perform ops.require(array['admin', 'operations'], 'assign a PCO');
  select * into v from ops.visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found' using errcode = 'P0002'; end if;
  if v.status <> 'needs_pco' then raise exception 'This visit already has a PCO' using errcode = '22023'; end if;
  perform ops.check_team(p_supervisor_id, p_crew_ids, true);

  update ops.visits
     set supervisor_id = p_supervisor_id, crew_ids = ops.clean_crew(p_supervisor_id, p_crew_ids), status = 'scheduled'
   where id = v.id;
  -- A new contract's site joins the client list now.
  update ops.sites set status = 'active' where id = v.site_id and status = 'pending';
end;
$$;

-- Schedule the monthly visits of one site. Only when every service visit of the
-- site is done; all days in one month, from today, after the last visit.
create function ops.schedule_month(
  p_site_id       uuid,
  p_dates         date[],
  p_time          text,
  p_supervisor_id uuid,
  p_crew_ids      uuid[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_site ops.sites%rowtype;
  v_last date;
  v_d    date;
begin
  perform ops.require(array['admin', 'operations'], 'schedule visits');
  select * into v_site from ops.sites where id = p_site_id for update;
  if not found then raise exception 'Site not found' using errcode = 'P0002'; end if;
  if v_site.status <> 'active' then
    raise exception 'Assign the PCO for the first contract visit before scheduling' using errcode = '22023';
  end if;
  if exists (select 1 from ops.visits where site_id = p_site_id
               and kind in ('monthly', 'contract', 'revisit') and status <> 'done') then
    raise exception 'You can schedule the next month only after every visit of this site is done' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_dates), 0) not between 1 and 8 then
    raise exception 'Pick 1 to 8 visits' using errcode = '22023';
  end if;
  if (select count(distinct date_trunc('month', d)) from unnest(p_dates) d) <> 1 then
    raise exception 'All visits must be in the same month' using errcode = '22023';
  end if;
  perform ops.check_time(p_time);
  perform ops.check_team(p_supervisor_id, p_crew_ids, true);

  select max(visit_date) into v_last from ops.visits
   where site_id = p_site_id and kind in ('monthly', 'contract', 'revisit');

  foreach v_d in array p_dates loop
    if v_d < ops.today() then raise exception 'Days must be today or later' using errcode = '22023'; end if;
    if v_last is not null and v_d <= v_last then
      raise exception 'Days must be after the last visit (%)', to_char(v_last, 'DD Mon') using errcode = '22023';
    end if;
    insert into ops.visits (kind, site_id, source, status, visit_date, visit_time,
                            supervisor_id, crew_ids, created_by_name)
    values ('monthly', p_site_id, 'ops', 'scheduled', v_d, p_time,
            p_supervisor_id, ops.clean_crew(p_supervisor_id, p_crew_ids), ops.me_name());
  end loop;
  return cardinality(p_dates);
end;
$$;

-- Change who goes. Meetings / inspections have no supervisor (the ops manager attends).
create function ops.set_team(p_visit_id uuid, p_supervisor_id uuid, p_crew_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare v ops.visits%rowtype;
begin
  perform ops.require(array['admin', 'operations'], 'change the team');
  select * into v from ops.visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found' using errcode = 'P0002'; end if;
  if v.status not in ('scheduled', 'started') then
    raise exception 'Only planned visits can change team' using errcode = '22023';
  end if;
  if v.kind in ('meeting', 'inspection') then
    perform ops.check_team(null, p_crew_ids, false);
    update ops.visits set supervisor_id = null, crew_ids = ops.clean_crew(null, p_crew_ids) where id = v.id;
  else
    perform ops.check_team(p_supervisor_id, p_crew_ids, true);
    update ops.visits set supervisor_id = p_supervisor_id, crew_ids = ops.clean_crew(p_supervisor_id, p_crew_ids) where id = v.id;
  end if;
end;
$$;

-- Move a visit to a new day. The old day is kept in the history.
-- For a visit that needs a new day, the team can be set at the same time.
create function ops.reschedule(
  p_visit_id      uuid,
  p_date          date,
  p_time          text,
  p_reason        text,
  p_note          text default null,
  p_set_team      boolean default false,
  p_supervisor_id uuid default null,
  p_crew_ids      uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare v ops.visits%rowtype;
begin
  perform ops.require(array['admin', 'operations'], 'reschedule');
  select * into v from ops.visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found' using errcode = 'P0002'; end if;
  if v.status not in ('scheduled', 'started', 'needs_new_day') then
    raise exception 'This visit cannot be rescheduled' using errcode = '22023';
  end if;
  if p_date is null or p_date < ops.today() then
    raise exception 'Pick today or a later day' using errcode = '22023';
  end if;
  perform ops.check_time(p_time);

  -- needs_new_day already has its history row (written when it was blocked / postponed).
  if v.status in ('scheduled', 'started') then
    if length(trim(coalesce(p_reason, ''))) = 0 then
      raise exception 'Pick why it moves' using errcode = '22023';
    end if;
    insert into ops.visit_history (visit_id, from_date, from_time, reason, note, by_name)
    values (v.id, v.visit_date, v.visit_time, trim(p_reason), nullif(trim(coalesce(p_note, '')), ''), ops.me_name());
  end if;

  update ops.visits
     set visit_date = p_date, visit_time = p_time, status = 'scheduled', started_at = null, before_photos = '{}'
   where id = v.id;

  if p_set_team then
    perform ops.set_team(v.id, p_supervisor_id, p_crew_ids);
  end if;
end;
$$;

-- Start a service visit (the 3 checks are confirmed in the form).
create function ops.start_visit(p_visit_id uuid, p_before_photos text[] default '{}')
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare v ops.visits%rowtype;
begin
  perform ops.require(array['admin', 'operations'], 'start a visit');
  select * into v from ops.visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found' using errcode = 'P0002'; end if;
  if v.kind not in ('monthly', 'contract', 'revisit') then
    raise exception 'Only service visits are started' using errcode = '22023';
  end if;
  if v.status <> 'scheduled' then raise exception 'This visit is not waiting to start' using errcode = '22023'; end if;
  update ops.visits
     set status = 'started', started_at = now(), before_photos = coalesce(p_before_photos, '{}')
   where id = v.id;
end;
$$;

-- Close out a service visit.
--   completed / partial → report saved, visit done, findings become site issues
--   blocked / postponed → no report; the visit needs a new day (red), history kept
create function ops.submit_service_report(
  p_visit_id     uuid,
  p_outcome      text,
  p_team_ids     uuid[],
  p_items        jsonb,
  p_extras       jsonb,
  p_findings     text[],
  p_notes        text,
  p_found_photos text[],
  p_after_photos text[],
  p_challan_no   text,
  p_challan_date date,
  p_challan_file text
)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v      ops.visits%rowtype;
  v_note text := nullif(trim(coalesce(p_notes, '')), '');
  v_f    text;
begin
  perform ops.require(array['admin', 'operations'], 'submit a service report');
  select * into v from ops.visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found' using errcode = 'P0002'; end if;
  if v.status <> 'started' then raise exception 'Start the visit first' using errcode = '22023'; end if;
  if coalesce(cardinality(p_team_ids), 0) = 0 then raise exception 'Tick who did the work' using errcode = '22023'; end if;
  perform ops.check_team(null, p_team_ids, false);

  if p_outcome in ('blocked', 'postponed') then
    insert into ops.visit_history (visit_id, from_date, from_time, reason, note, by_name)
    values (v.id, v.visit_date, v.visit_time,
            case when p_outcome = 'blocked' then 'Client blocked access' else 'Postponed' end, v_note, ops.me_name());
    update ops.visits set status = 'needs_new_day', started_at = null where id = v.id;
    return;
  end if;
  if p_outcome not in ('completed', 'partial') then
    raise exception 'Pick what happened on this visit' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception 'Add at least one item or product used' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
              where length(trim(coalesce(i ->> 'name', ''))) = 0
                 or coalesce((i ->> 'qty')::numeric, 0) <= 0) then
    raise exception 'Enter the name and quantity for every item' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_challan_no, ''))) = 0 then
    raise exception 'Enter the physical challan number. It is mandatory.' using errcode = '22023';
  end if;
  if p_challan_date is null then raise exception 'Enter the challan date' using errcode = '22023'; end if;
  if length(trim(coalesce(p_challan_file, ''))) = 0 then
    raise exception 'Upload the signed challan picture or document. It is mandatory.' using errcode = '22023';
  end if;
  if exists (select 1 from ops.service_reports where lower(trim(challan_no)) = lower(trim(p_challan_no))) then
    raise exception 'Challan % is already used on another visit', trim(p_challan_no) using errcode = '23505';
  end if;

  insert into ops.service_reports (visit_id, outcome, team_ids, items, extras, findings, notes,
                                   found_photos, after_photos, challan_no, challan_date, challan_file, submitted_by_name)
  values (v.id, p_outcome, (select array_agg(distinct t) from unnest(p_team_ids) t),
          p_items, coalesce(p_extras, '[]'),
          coalesce((select array_agg(trim(f)) from unnest(p_findings) f where length(trim(f)) > 0), '{}'),
          v_note, coalesce(p_found_photos, '{}'), coalesce(p_after_photos, '{}'),
          trim(p_challan_no), p_challan_date, p_challan_file, ops.me_name());

  foreach v_f in array coalesce(p_findings, '{}') loop
    if length(trim(v_f)) > 0 then
      insert into ops.site_issues (site_id, description, source_visit_id) values (v.site_id, trim(v_f), v.id);
    end if;
  end loop;

  update ops.visits set status = 'done' where id = v.id;
  perform ops.resolve_complaint(v);
end;
$$;

create function ops.submit_meeting_report(p_visit_id uuid, p_joined text, p_outcome text, p_notes text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare v ops.visits%rowtype;
begin
  perform ops.require(array['admin', 'operations'], 'write a meeting report');
  select * into v from ops.visits where id = p_visit_id for update;
  if not found or v.kind <> 'meeting' then raise exception 'Meeting not found' using errcode = 'P0002'; end if;
  if v.status <> 'scheduled' then raise exception 'This meeting already has a report' using errcode = '22023'; end if;
  if length(trim(coalesce(p_joined, ''))) = 0 then raise exception 'Write who joined the meeting' using errcode = '22023'; end if;
  insert into ops.meeting_reports (visit_id, joined, outcome, notes, written_by_name)
  values (v.id, trim(p_joined), p_outcome, nullif(trim(coalesce(p_notes, '')), ''), ops.me_name());
  update ops.visits set status = 'done' where id = v.id;
  perform ops.resolve_complaint(v);
end;
$$;

create function ops.submit_inspection_report(p_visit_id uuid, p_activity text, p_advice text, p_areas text, p_notes text)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare v ops.visits%rowtype;
begin
  perform ops.require(array['admin', 'operations'], 'write an inspection report');
  select * into v from ops.visits where id = p_visit_id for update;
  if not found or v.kind <> 'inspection' then raise exception 'Inspection not found' using errcode = 'P0002'; end if;
  if v.status <> 'scheduled' then raise exception 'This inspection already has a report' using errcode = '22023'; end if;
  if length(trim(coalesce(p_areas, ''))) = 0 then raise exception 'Write which areas were checked' using errcode = '22023'; end if;
  insert into ops.inspection_reports (visit_id, activity, advice, areas, notes, written_by_name)
  values (v.id, p_activity, p_advice, trim(p_areas), nullif(trim(coalesce(p_notes, '')), ''), ops.me_name());
  update ops.visits set status = 'done' where id = v.id;
  perform ops.resolve_complaint(v);
end;
$$;

create function ops.fix_issue(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  perform ops.require(array['admin', 'operations'], 'mark an issue fixed');
  update ops.site_issues set open = false, fixed_at = now(), fixed_by_name = ops.me_name()
   where id = p_issue_id and open;
  if not found then raise exception 'Issue not found or already fixed' using errcode = 'P0002'; end if;
end;
$$;

-------------------------------------------------------------------------------
-- 11. Who may run which function
-------------------------------------------------------------------------------
revoke all on all functions in schema ops from public, anon;
grant execute on all functions in schema ops to authenticated;
-- Internal helpers are not called from the apps.
revoke execute on function ops.set_client_code(), ops.set_job_code(), ops.touch(),
  ops.resolve_complaint(ops.visits) from authenticated;

-------------------------------------------------------------------------------
-- 12. Files (signed challans, photos): private bucket "ops-files"
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ops-files', 'ops-files', false)
on conflict (id) do nothing;

drop policy if exists "Ops files: admin and operations read" on storage.objects;
drop policy if exists "Ops files: admin and operations upload" on storage.objects;

create policy "Ops files: admin and operations read" on storage.objects
  for select to authenticated using (bucket_id = 'ops-files' and ops.can_view());
create policy "Ops files: admin and operations upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'ops-files' and ops.can_view());

-------------------------------------------------------------------------------
-- 13. Live updates: the apps refresh when admin or operations change something
-------------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table
    ops.visits, ops.complaints, ops.sites, ops.clients, ops.staff, ops.site_issues;
exception when undefined_object then
  raise notice 'Realtime publication not found; live updates are off.';
end;
$$;

commit;
